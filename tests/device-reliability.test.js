import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import nacl from "tweetnacl";
import { WebSocket } from "ws";
import { base64Decode, base64Encode, utf8Decode, utf8Encode } from "../lib/shared/base64.js";
import { CLOSE_AUTH_FAILED, DEVICE_IDLE_TTL_MS, HANDSHAKE_TIMEOUT_MS, SOFT_BUFFER_LIMIT } from "../lib/shared/constants.js";
import { MobileE2eeSession, generateClientKeyPair } from "../lib/mobile/e2ee.js";
import { MobileDataPlane } from "../lib/server/dataplane.js";
import { AuditLogger, DeviceRegistry, OfferRegistry } from "../lib/server/registry.js";
import { RendezvousClient } from "../lib/server/relay.js";
import { MockRendezvous } from "./mock-relay.mjs";

const logger = { debug() {}, info() {}, warn() {}, error() {} };

test("a real E2EE queued push is discarded when the device expires before drain", async () => {
 const now = { value: Date.now() }, upstream = createUpstream();
 const { plane, offers, serverKeyPair } = createPlane(now, upstream);
 const originalSend = WebSocket.prototype.send;
 let serverSocket, client;
 WebSocket.prototype.send = function(data, ...args) {
  if (typeof data === "string" && data.includes('"e2ee_ready"')) serverSocket = this;
  return originalSend.call(this, data, ...args);
 };
 try {
  await plane.listen("127.0.0.1"); const key = base64Encode(serverKeyPair.publicKey);
  const offer = offers.createOffer({ endpoint: "ws://127.0.0.1/m/ws", pageUrl: "http://127.0.0.1/m/", publicKeyB64: key, ttlMs: HANDSHAKE_TIMEOUT_MS }).offer;
  client = await connectE2ee(`ws://127.0.0.1:${plane.boundPort}/m/ws`, offer.deviceToken, key);
  assert.ok(serverSocket);
  await requestRpc(client, { id: "subscribe", method: "host.subscribe", params: {} });
  Object.defineProperty(serverSocket, "bufferedAmount", { configurable: true, value: SOFT_BUFFER_LIMIT + 1 });
  upstream.emit({ push: "host.event", data: { marker: "must-never-drain" } });
  now.value += DEVICE_IDLE_TTL_MS + 1;
  const terminal = nextRpc(client, "expiry error"), closed = waitFor(client.ws, "close");
  delete serverSocket.bufferedAmount;
  assert.equal((await terminal).error.code, "unauthorized");
  assert.equal((await closed)[0], CLOSE_AUTH_FAILED);
  assert.equal(upstream.subscriberCount, 0);
 } finally { WebSocket.prototype.send = originalSend; client?.ws.terminate(); await plane.close(); }
});

test("storage failure during pong or RPC closes only that connection without escaping the process", async () => {
 for (const signal of ["pong", "rpc"]) {
  const now = { value: Date.now() }, upstream = createUpstream();
  const { plane, registry, offers, serverKeyPair } = createPlane(now, upstream);
  let client;
  try {
   await plane.listen("127.0.0.1");
   const key = base64Encode(serverKeyPair.publicKey);
   const offer = offers.createOffer({ endpoint: "ws://127.0.0.1/m/ws", pageUrl: "http://127.0.0.1/m/", publicKeyB64: key, ttlMs: HANDSHAKE_TIMEOUT_MS }).offer;
   client = await connectE2ee(`ws://127.0.0.1:${plane.boundPort}/m/ws`, offer.deviceToken, key);
   registry.touch = () => { throw new Error("EIO fixture"); };
   plane.audit.log = () => { throw new Error("EIO audit fixture"); };
   const closed = waitFor(client.ws, "close");
   if (signal === "pong") client.ws.pong(); else sendRpc(client, { id: "failure", method: "session.list", params: {} });
   assert.equal((await closed)[0], 1011);
   assert.equal(upstream.subscriberCount, 0);
   assert.equal(plane.connectionCount, 0);
  } finally { client?.ws.terminate(); await plane.close(); }
 }
});

function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function waitFor(ws, event, label = event, timeoutMs = HANDSHAKE_TIMEOUT_MS) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs);
		ws.once(event, (...args) => {
			clearTimeout(timer);
			resolve(args);
		});
		ws.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		if (event !== "close") {
			ws.once("close", (code, reason) => {
				clearTimeout(timer);
				reject(new Error(`socket closed (${code}): ${String(reason)}`));
			});
		}
	});
}

async function openWs(url) {
	const ws = new WebSocket(url);
	await waitFor(ws, "open");
	return ws;
}

async function nextMessage(ws, label = "message") {
	const [data, isBinary] = await waitFor(ws, "message", label);
	assert.equal(isBinary, false);
	return String(data);
}

async function connectE2ee(url, token, publicKeyB64, label = url) {
	const ws = await openWs(url);
	const frames = [];
	ws.on("message", (data, isBinary) => frames.push({ data: String(data), isBinary }));
	const keyPair = generateClientKeyPair();
	const session = new MobileE2eeSession({
		clientSecretKey: keyPair.secretKey,
		clientPublicKey: keyPair.publicKey,
		pinnedPublicKeyB64: publicKeyB64,
	});
	const ready = nextMessage(ws, `${label} ready`);
	ws.send(JSON.stringify(session.hello));
	assert.equal(session.receiveReady(JSON.parse(await ready)).ok, true);
	const authenticatedWait = nextMessage(ws, `${label} authenticated`);
	ws.send(base64Encode(session.sealOut(utf8Encode(JSON.stringify(session.auth(token))))));
	const authenticated = JSON.parse(utf8Decode(session.openIn(base64Decode(await authenticatedWait))));
	assert.equal(session.receiveAuthenticated(authenticated).ok, true);
	return { ws, session, frames };
}

async function expectUnauthorized(url, token, publicKeyB64) {
	const ws = await openWs(url);
	const keyPair = generateClientKeyPair();
	const session = new MobileE2eeSession({ clientSecretKey: keyPair.secretKey, clientPublicKey: keyPair.publicKey, pinnedPublicKeyB64: publicKeyB64 });
	const ready = nextMessage(ws, "revoked device ready");
	ws.send(JSON.stringify(session.hello));
	assert.equal(session.receiveReady(JSON.parse(await ready)).ok, true);
	const error = nextMessage(ws, "revoked device error");
	const closed = waitFor(ws, "close");
	ws.send(base64Encode(session.sealOut(utf8Encode(JSON.stringify(session.auth(token))))));
	const decrypted = JSON.parse(utf8Decode(session.openIn(base64Decode(await error))));
	assert.equal(decrypted.error.code, "unauthorized");
	assert.equal((await closed)[0], CLOSE_AUTH_FAILED);
}

function sendRpc(client, request) {
	client.ws.send(base64Encode(client.session.sealOut(utf8Encode(JSON.stringify(request)))));
}

async function nextRpc(client, label = "RPC reply") {
	return JSON.parse(utf8Decode(client.session.openIn(base64Decode(await nextMessage(client.ws, label)))));
}

async function requestRpc(client, request, label) {
	const reply = nextRpc(client, label);
	sendRpc(client, request);
	return reply;
}

function createUpstream() {
	const subscribers = new Set();
	const promptGate = deferred();
	const promptStarted = deferred();
	let promptCalls = 0;
	return {
		addSubscriber(subscriber) { subscribers.add(subscriber); },
		removeSubscriber(subscriber) { subscribers.delete(subscriber); },
		subscribeSession(subscriber, sessionId) { subscriber.sessionIds.add(sessionId); },
		unsubscribeSession(subscriber, sessionId) { subscriber.sessionIds.delete(sessionId); },
		subscribeHost(subscriber) { subscriber.host = true; },
		pending() { return []; },
		async list() { return { ok: true, value: { items: [{ sessionId: "s-1", running: false, blank: false, updatedAt: 1 }] } }; },
		async history() { return { ok: true, value: { events: [], hasMore: false } }; },
		async prompt() { promptCalls += 1; promptStarted.resolve(); return promptGate.promise; },
		async cancel() { return { ok: true, value: { accepted: true } }; },
		async create() { return { ok: true, value: { sessionId: "s-new" } }; },
		async respond() { return { ok: true, value: { accepted: true } }; },
		stop() {},
		emit(push) { for (const subscriber of subscribers) if (subscriber.host) subscriber.send(push); },
		get subscriberCount() { return subscribers.size; },
		get promptCalls() { return promptCalls; },
		waitForPrompt() { return promptStarted.promise; },
		resolvePrompt(value = { ok: true, value: { accepted: true } }) { promptGate.resolve(value); },
	};
}

function createPlane(now, upstream) {
	const directory = mkdtempSync(join(tmpdir(), "dshmr-device-real-ws-"));
	const registry = new DeviceRegistry(directory);
	const offers = new OfferRegistry();
	const serverKeyPair = nacl.box.keyPair();
	const plane = new MobileDataPlane({
		serverKeyPair,
		registry,
		offers,
		audit: new AuditLogger(directory),
		logger,
		mobileDir: directory,
		port: 0,
		upstream,
		now: () => now.value,
	});
	return { plane, registry, offers, serverKeyPair, directory };
}

test("real LAN and relay E2EE connections revoke one device without leaking inflight replies or pushes to another device", async () => {
	const now = { value: 1_000 };
	const upstream = createUpstream();
	const { plane, registry, offers, serverKeyPair, directory } = createPlane(now, upstream);
	const relay = new MockRendezvous({ now: () => now.value });
	const origin = await relay.listen();
	const rendezvous = new RendezvousClient({
		persistFile: join(directory, "relay.json"),
		logger,
		offers,
		connectionDeps: () => plane.connectionDeps("relay"),
	});
	let aLan;
	let aRelay;
	let bLan;
	try {
		await plane.listen("127.0.0.1");
		await rendezvous.start({ origin, hostToken: "test-host-token" });
		const key = base64Encode(serverKeyPair.publicKey);
		const aOffer = offers.createOffer({ endpoint: "ws://lan/m/ws", pageUrl: "http://lan/m/", publicKeyB64: key, ttlMs: 60_000, now: now.value }).offer;
		const bOffer = offers.createOffer({ endpoint: "ws://lan/m/ws", pageUrl: "http://lan/m/", publicKeyB64: key, ttlMs: 60_000, now: now.value }).offer;
		aLan = await connectE2ee(`ws://127.0.0.1:${plane.boundPort}/m/ws`, aOffer.deviceToken, key, "A LAN");
		const invite = rendezvous.createInvite();
		await rendezvous.putInvite({ invite, expiresAt: now.value + 60_000, offerId: "a-relay" });
		aRelay = await connectE2ee(rendezvous.advertise(invite).endpoint, aOffer.deviceToken, key, "A relay");
		bLan = await connectE2ee(`ws://127.0.0.1:${plane.boundPort}/m/ws`, bOffer.deviceToken, key, "B LAN");
		assert.equal(plane.connectionCount, 3);

		for (const [index, client] of [aLan, aRelay].entries()) {
			assert.equal((await requestRpc(client, { id: `host-${index}`, method: "host.subscribe", params: {} }, `host subscribe ${index}`)).ok, true);
		}
		assert.equal(upstream.subscriberCount, 3);
		const aDevice = registry.findByTokenHash(registry.devices[0].tokenHash);
		assert.ok(aDevice);
		sendRpc(aLan, { id: "inflight", method: "session.prompt", params: { sessionId: "s-1", text: "hold" } });
		await upstream.waitForPrompt();
		upstream.emit({ push: "host.event", data: { marker: "queued-before-revoke" } });

		const aLanClosed = waitFor(aLan.ws, "close");
		const aRelayClosed = waitFor(aRelay.ws, "close");
		assert.equal(plane.revokeDevice(aDevice.deviceId), true);
		assert.equal((await aLanClosed)[0], CLOSE_AUTH_FAILED);
		assert.equal((await aRelayClosed)[0], 1001);
		assert.equal(upstream.subscriberCount, 1);
		const aLanFramesAtRevoke = aLan.frames.length;
		const aRelayFramesAtRevoke = aRelay.frames.length;
		upstream.resolvePrompt();
		assert.equal((await requestRpc(bLan, { id: "host-b", method: "host.subscribe", params: {} }, "B host subscribe")).ok, true);
		const bPushWait = nextRpc(bLan, "B push");
		upstream.emit({ push: "host.event", data: { message: "only-b" } });
		const bPush = await bPushWait;
		assert.equal(bPush.push, "host.event");
		assert.equal(aLan.frames.length, aLanFramesAtRevoke);
		assert.equal(aRelay.frames.length, aRelayFramesAtRevoke);
		await expectUnauthorized(`ws://127.0.0.1:${plane.boundPort}/m/ws`, aOffer.deviceToken, key);

		assert.equal((await requestRpc(bLan, { id: "read", method: "session.list", params: {} }, "B read")).result.items[0].sessionId, "s-1");
		assert.equal((await requestRpc(bLan, { id: "write", method: "session.prompt", params: { sessionId: "s-1", text: "still-live" } }, "B write")).ok, true);
		assert.equal(upstream.promptCalls, 2);
	} finally {
		for (const client of [aLan, aRelay, bLan]) client?.ws.terminate();
		await rendezvous.stop();
		await relay.close();
		await plane.close();
	}
});

test("authenticated pong and RPC refresh a live device, while an idle-expired device cannot be revived by a push", async () => {
	const now = { value: 1_000 };
	const upstream = createUpstream();
	const { plane, registry, offers, serverKeyPair } = createPlane(now, upstream);
	let client;
	try {
		await plane.listen("127.0.0.1");
		const key = base64Encode(serverKeyPair.publicKey);
		const offer = offers.createOffer({ endpoint: "ws://lan/m/ws", pageUrl: "http://lan/m/", publicKeyB64: key, ttlMs: DEVICE_IDLE_TTL_MS * 2, now: now.value }).offer;
		client = await connectE2ee(`ws://127.0.0.1:${plane.boundPort}/m/ws`, offer.deviceToken, key, "TTL LAN");
		assert.equal(plane.connectionCount, 1);
		assert.equal((await requestRpc(client, { id: "ttl-host", method: "host.subscribe", params: {} }, "TTL host subscribe")).ok, true);
		const deviceId = registry.devices[0].deviceId;
		const originalTouch = registry.touch.bind(registry);
		let resolveTouch;
		registry.touch = (id, timestamp) => {
			originalTouch(id, timestamp);
			resolveTouch?.(timestamp);
		};

		now.value += 10;
		const pongTouched = new Promise((resolve) => { resolveTouch = resolve; });
		client.ws.pong();
		assert.equal(await pongTouched, now.value);
		now.value += 10;
		const rpcTouched = new Promise((resolve) => { resolveTouch = resolve; });
		assert.equal((await requestRpc(client, { id: "status", method: "status.get", params: {} }, "status reply")).ok, true);
		assert.equal(await rpcTouched, now.value);
		assert.equal(registry.findById(deviceId).lastSeenAt, now.value);

		now.value += DEVICE_IDLE_TTL_MS + 1;
		const expiredClosed = waitFor(client.ws, "close");
		upstream.emit({ push: "host.event", data: { message: "expired" } });
		assert.equal((await expiredClosed)[0], CLOSE_AUTH_FAILED);
		assert.equal(registry.findById(deviceId).lastSeenAt, now.value - DEVICE_IDLE_TTL_MS - 1);
	} finally {
		client?.ws.terminate();
		await plane.close();
	}
});
