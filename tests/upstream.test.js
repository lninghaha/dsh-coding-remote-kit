import assert from "node:assert/strict";
import test from "node:test";
import nacl from "tweetnacl";
import { generateClientKeyPair, MobileE2eeSession } from "../lib/mobile/e2ee.js";
import { dispatchRpc } from "../lib/server/rpc.js";
import { ServerHandshake } from "../lib/server/e2ee.js";
import { createUpstreamHub, mapHostFrame, mapMuxFrame } from "../lib/server/upstream.js";
import { base64Encode } from "../lib/shared/base64.js";

function silentLogger() {
	return { debug() {}, info() {}, warn() {}, error() {} };
}

function abortWait(signal) {
	return new Promise((resolve) => {
		if (signal.aborted) {
			resolve();
			return;
		}
		signal.addEventListener("abort", () => resolve(), { once: true });
	});
}

async function waitUntil(predicate, timeoutMs = 1000) {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

function createFakeApi(respondCalls) {
	return {
		sessions: {
			async list(request) {
				return {
					rpcId: request.rpcId,
					result: {
						ok: true,
						value: {
							items: [
								{
									sessionId: "sess-1",
									updatedAt: 1000,
									running: false,
									blank: false,
									cwd: "/tmp",
									projections: { asOfSeq: 1, values: { title: "Demo session" } },
								},
							],
						},
					},
				};
			},
			async history(request) {
				return { rpcId: request.rpcId, result: { ok: true, value: { events: [], hasMore: false } } };
			},
			async prompt(request) {
				return { rpcId: request.rpcId, result: { ok: true, value: { accepted: true } } };
			},
			async cancel(request) {
				return { rpcId: request.rpcId, result: { ok: true, value: { accepted: true } } };
			},
		},
		events: {
			async *mux(_request, signal) {
				yield {
					rpcId: "approval-rpc-1",
					payload: {
						type: "approval/requested",
						sessionId: "sess-1",
						approvalId: "appr-1",
						toolName: "bash",
						reason: "run command",
					},
				};
				await abortWait(signal);
			},
			async *host(_request, signal) {
				await abortWait(signal);
			},
		},
		async respond(message) {
			respondCalls.push(message);
			return { accepted: true };
		},
	};
}

function completeHandshake() {
	const serverKeyPair = nacl.box.keyPair();
	const mobileKeyPair = generateClientKeyPair();
	const mobile = new MobileE2eeSession({
		clientSecretKey: mobileKeyPair.secretKey,
		clientPublicKey: mobileKeyPair.publicKey,
		pinnedPublicKeyB64: base64Encode(serverKeyPair.publicKey),
	});
	const server = new ServerHandshake(serverKeyPair, () => ({ kind: "ok", device: { deviceId: "device-42" } }));
	const started = server.start(mobile.hello);
	assert.equal(started.ok, true);
	assert.equal(mobile.receiveReady(started.ready).ok, true);
	const finished = server.finish(mobile.auth("pairing-token-for-handshake-test"));
	assert.equal(finished.ok, true);
	assert.equal(mobile.receiveAuthenticated(finished.authenticated).ok, true);
	return finished;
}

test("unknown mux / host frames are dropped", () => {
	assert.equal(mapMuxFrame("x", { type: "session/jobs", sessionId: "s" }), null);
	assert.equal(mapHostFrame({ type: "host/workspace-changed" }), null);
});

test("in-process handshake + fake apiProxy list/subscribe/respond", async () => {
	const finished = completeHandshake();
	const respondCalls = [];
	const hub = createUpstreamHub(createFakeApi(respondCalls), silentLogger());
	const pushes = [];
	const subscriber = { send(push) { pushes.push(push); }, sessionIds: new Set(), host: false };
	hub.addSubscriber(subscriber);
	const audit = { entries: [], log(entry) { this.entries.push(entry); } };
	const ctx = {
		upstream: hub,
		deviceId: finished.deviceId,
		audit,
		connection: {
			subscribeSession(sessionId) {
				hub.subscribeSession(subscriber, sessionId);
			},
			unsubscribeSession(sessionId) {
				hub.unsubscribeSession(subscriber, sessionId);
			},
			subscribeHost() {
				hub.subscribeHost(subscriber);
			},
		},
	};

	const listed = await dispatchRpc({ id: 1, method: "session.list", params: {} }, ctx);
	assert.equal(listed.ok, true);
	assert.equal(listed.result.items[0].sessionId, "sess-1");
	assert.equal(listed.result.items[0].title, "Demo session");
	assert.equal(listed.result.items[0].cwd, "/tmp");

	const subscribed = await dispatchRpc({ id: 2, method: "session.subscribe", params: { sessionId: "sess-1" } }, ctx);
	assert.equal(subscribed.ok, true);
	assert.equal(subscribed.result.accepted, true);

	await waitUntil(() => pushes.some((push) => push.push === "approval.requested"));
	const approval = pushes.find((push) => push.push === "approval.requested");
	assert.equal(approval.rpcId, "approval-rpc-1");
	assert.equal(approval.data.sessionId, "sess-1");
	assert.equal(approval.data.approvalId, "appr-1");
	assert.equal(approval.data.toolName, "bash");

	const answered = await dispatchRpc(
		{
			id: 3,
			method: "respond",
			params: {
				rpcId: approval.rpcId,
				sessionId: "sess-1",
				approvalId: "appr-1",
				outcome: "allowed-once",
			},
		},
		ctx,
	);
	assert.equal(answered.ok, true);
	assert.equal(respondCalls.length, 1);
	assert.equal(respondCalls[0].type, "client-response");
	assert.equal(respondCalls[0].rpcId, "approval-rpc-1");
	assert.equal(respondCalls[0].result.ok, true);
	assert.equal(respondCalls[0].result.value.approvalId, "appr-1");
	assert.equal(audit.entries[0].event, "rpc_write");
	assert.equal(audit.entries[0].detail.method, "respond");

	hub.stop();
});

test("upstream errors fold to upstream_error without details", async () => {
	const hub = createUpstreamHub(
		{
			sessions: {
				async list() {
					return {
						rpcId: "x",
						result: {
							ok: false,
							error: { code: "session-not-found", message: "missing", details: { secret: "nope" } },
						},
					};
				},
				async history() {
					throw new Error("boom");
				},
				async prompt() {
					return { rpcId: "x", result: { ok: true, value: {} } };
				},
				async cancel() {
					return { rpcId: "x", result: { ok: true, value: {} } };
				},
			},
			events: {
				async *mux(_request, signal) {
					await abortWait(signal);
				},
				async *host(_request, signal) {
					await abortWait(signal);
				},
			},
			async respond() {
				return { accepted: true };
			},
		},
		silentLogger(),
	);
	const listed = await dispatchRpc({ id: 1, method: "session.list", params: {} }, { upstream: hub });
	assert.equal(listed.ok, false);
	assert.equal(listed.error.code, "upstream_error");
	assert.equal(listed.error.message, "missing");
	assert.equal(JSON.stringify(listed).includes("nope"), false);
	hub.stop();
});
