import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import { OfferRegistry } from "../lib/server/registry.js";
import { RendezvousClient, validateRelayStartBody } from "../lib/server/relay.js";
import { registerManagementRoutes } from "../lib/server/routes.js";
import { MockRendezvous } from "./mock-relay.mjs";

function silentLogger() {
	return { debug() {}, info() {}, warn() {}, error() {} };
}

test("validateRelayStartBody requires https origin when provided", () => {
	assert.deepEqual(validateRelayStartBody({ action: "start", origin: "https://example.com" }), {
		origin: "https://example.com",
	});
	assert.throws(() => validateRelayStartBody({ origin: "http://example.com" }));
	assert.deepEqual(validateRelayStartBody({ action: "start" }), {});
});

test("rendezvous client connects, registers invite, and snapshots omit the token", async () => {
	const mock = new MockRendezvous({ hostToken: "YOUR_TOKEN" });
	const origin = await mock.listen();
	const persistFile = join(mkdtempSync(join(tmpdir(), "dshmr-relay-")), "relay.json");
	const offers = new OfferRegistry();
	const client = new RendezvousClient({
		persistFile,
		logger: silentLogger(),
		offers,
		connectionDeps: () => {
			throw new Error("accept not expected");
		},
		connect: (url) => new WebSocket(url),
	});
	try {
		const started = await client.start({ origin, hostToken: "YOUR_TOKEN" });
		assert.equal(started, origin);
		const snapshot = client.snapshot();
		assert.equal(snapshot.running, true);
		assert.equal(snapshot.kind, "rendezvous");
		assert.equal(snapshot.hostConnected, true);
		assert.equal(snapshot.hasToken, true);
		assert.equal("hostToken" in snapshot, false);
		assert.equal(snapshot.url, origin);
		assert.ok(!JSON.stringify(snapshot).includes("YOUR_TOKEN"));
		const invite = client.createInvite();
		const advertised = client.advertise(invite);
		assert.match(advertised.endpoint, /^ws:\/\/127\.0\.0\.1:\d+\/v1\/phone\//);
		assert.match(advertised.pageUrl, /^http:\/\/127\.0\.0\.1:\d+\/m\/$/);
		await client.putInvite({ invite, expiresAt: Date.now() + 60_000, offerId: "offer-1" });
		assert.equal(mock.invites.has(invite), true);
	} finally {
		await client.stop();
		await mock.close();
	}
});

test("rendezvous splices phone bytes onto the desktop accept socket", async () => {
	const mock = new MockRendezvous({ hostToken: "YOUR_TOKEN" });
	const origin = await mock.listen();
	const persistFile = join(mkdtempSync(join(tmpdir(), "dshmr-relay-")), "relay.json");
	const offers = new OfferRegistry();
	let accepted = null;
	const client = new RendezvousClient({
		persistFile,
		logger: silentLogger(),
		offers,
		connectionDeps: () => ({
			serverKeyPair: { secretKey: new Uint8Array(32), publicKey: new Uint8Array(32) },
			resolveToken: () => ({ kind: "bad_auth", reason: "unused" }),
			audit: { log() {} },
			logger: silentLogger(),
			upstream: { addSubscriber() {}, removeSubscriber() {}, subscribeSession() {}, unsubscribeSession() {}, subscribeHost() {} },
			admit: () => true,
			release() {},
		}),
		connect: (url) => {
			const ws = new WebSocket(url);
			if (url.includes("/v1/accept/")) accepted = ws;
			return ws;
		},
	});
	try {
		await client.start({ origin, hostToken: "YOUR_TOKEN" });
		const invite = client.createInvite();
		const advertised = client.advertise(invite);
		await client.putInvite({ invite, expiresAt: Date.now() + 60_000, offerId: "offer-1" });
		const phone = new WebSocket(advertised.endpoint);
		await new Promise((resolve, reject) => {
			phone.once("open", resolve);
			phone.once("error", reject);
		});
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.ok(accepted !== null, "desktop opened an accept socket");
		await new Promise((resolve, reject) => {
			if (accepted.readyState === WebSocket.OPEN) {
				resolve();
				return;
			}
			accepted.once("open", resolve);
			accepted.once("error", reject);
		});
		const echoed = new Promise((resolve) => {
			phone.on("message", (data) => resolve(String(data)));
		});
		accepted.send("from-desktop");
		assert.equal(await echoed, "from-desktop");
		phone.close();
	} finally {
		await client.stop();
		await mock.close();
	}
});

test("starting a rendezvous route stops the Quick Tunnel and does not leak the token", async () => {
	const paths = [];
	const tunnel = {
		stopped: false,
		snapshot: () => ({ running: true, kind: "cloudflare-quick", url: "https://example.trycloudflare.com", binaryOk: true }),
		async start() {
			return "https://example.trycloudflare.com";
		},
		async stop() {
			this.stopped = true;
		},
	};
	const relay = {
		stopped: false,
		snapshot: () => ({
			running: true,
			kind: "rendezvous",
			url: "https://example.com",
			hostConnected: true,
			binaryOk: true,
			hasToken: true,
		}),
		async start() {
			return "https://example.com";
		},
		async stop() {
			this.stopped = true;
		},
		createInvite: () => "invite",
		advertise: () => ({
			endpoint: "wss://example.com/v1/phone/h?invite=invite",
			pageUrl: "https://example.com/m/",
			candidates: ["example.com"],
		}),
		async putInvite() {},
	};
	const webServer = {
		register(route) {
			paths.push(route.path);
			return () => {};
		},
	};
	registerManagementRoutes(webServer, {
		logger: silentLogger(),
		now: () => 0,
		publicKeyB64: "pk",
		offerTtlMs: 1000,
		registry: { networkReach: "this-computer", activeDeviceCount: () => 0, revoke() { return null; }, devices: [] },
		offers: { createOffer() { return { offer: { offerId: "o", expiresAt: 1 }, pairCode: "AAAA-AAAA" }; }, count: () => 0 },
		audit: { log() {} },
		trustedHosts: [],
		listening: () => true,
		currentBind: () => "127.0.0.1",
		port: () => 6879,
		async widen() {},
		advertise: () => ({ endpoint: "ws://127.0.0.1/m/ws", pageUrl: "http://127.0.0.1/m", candidates: ["127.0.0.1"] }),
		tunnel,
		relay,
		async installCloudflared() {
			return { asset: "cloudflared-linux-amd64", path: "/tmp/cloudflared" };
		},
	});
	assert.ok(paths.includes("/api/mobile-remote/relay"));
	assert.equal(paths.filter((path) => path === "/api/mobile-remote/relay").length, 1);
});
