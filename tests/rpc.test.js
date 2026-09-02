import assert from "node:assert/strict";
import test from "node:test";
import { MOBILE_RPC_METHOD_ALLOWLIST } from "../lib/shared/constants.js";
import { dispatchRpc, isMethodAllowed } from "../lib/server/rpc.js";

const ALLOWED = [
	"status.get",
	"session.list",
	"session.history",
	"session.subscribe",
	"session.unsubscribe",
	"host.subscribe",
	"session.prompt",
	"session.cancel",
	"session.create",
	"respond",
	"device.name",
];

function auditSink() {
	const entries = [];
	return {
		entries,
		log(entry) {
			entries.push(entry);
		},
	};
}

test("status.get is allowed and returns the frozen status result", async () => {
	const result = await dispatchRpc({ id: 1, method: "status.get" });
	assert.equal(result.ok, true);
	assert.equal(result.id, 1);
	assert.equal(result.result.protocolVersion, 1);
	assert.equal(result.result.minCompatibleMobileVersion, 1);
	assert.equal(result.result.deviceScope, "mobile");
});

test("allowlist matrix: supported methods are not forbidden", async () => {
	assert.deepEqual([...MOBILE_RPC_METHOD_ALLOWLIST], ALLOWED);
	for (const method of ALLOWED) {
		assert.equal(isMethodAllowed(method), true, method);
		const result = await dispatchRpc({ id: 1, method, params: {} });
		assert.notEqual(result.error?.code, "forbidden", method);
	}
});

test("device.name updates only the authenticated device and does not log the name", async () => {
	const audit = auditSink();
	let renamed = null;
	const result = await dispatchRpc(
		{ id: 8, method: "device.name", params: { name: "Pocket DSH" } },
		{
			deviceId: "dev-3",
			audit,
			renameDevice(deviceId, name) {
				renamed = { deviceId, name };
				return true;
			},
		},
	);
	assert.equal(result.ok, true);
	assert.deepEqual(renamed, { deviceId: "dev-3", name: "Pocket DSH" });
	assert.equal(audit.entries[0].event, "device_named");
	assert.equal(JSON.stringify(audit.entries[0]).includes("Pocket DSH"), false);
});

test("device.name rejects control characters", async () => {
	let called = false;
	const result = await dispatchRpc(
		{ id: 9, method: "device.name", params: { name: "Pocket\u0000DSH" } },
		{ deviceId: "dev-3", renameDevice() { called = true; return true; } },
	);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "invalid_params");
	assert.equal(called, false);
});

test("methods outside the allowlist are forbidden", async () => {
	for (const method of ["files.delete", "session.fork", "settings.update"]) {
		const result = await dispatchRpc({ id: 2, method });
		assert.equal(result.ok, false, method);
		assert.equal(result.error.code, "forbidden", method);
	}
});

test("malformed envelopes → invalid_params", async () => {
	assert.equal((await dispatchRpc(null)).ok, false);
	assert.equal((await dispatchRpc({ method: "status.get" })).error.code, "invalid_params");
	assert.equal((await dispatchRpc({ id: 1 })).error.code, "invalid_params");
	assert.equal((await dispatchRpc({ id: 1, method: 7 })).error.code, "invalid_params");
});

test("session.prompt empty text → invalid_params and no rpc_write", async () => {
	const audit = auditSink();
	const result = await dispatchRpc(
		{ id: 3, method: "session.prompt", params: { sessionId: "s1", text: "   " } },
		{ deviceId: "dev-1", audit },
	);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "invalid_params");
	assert.equal(audit.entries.length, 0);
});

test("session.prompt writes rpc_write without the prompt text", async () => {
	const audit = auditSink();
	const upstream = {
		async prompt(params) {
			assert.equal(params.text, "secret prompt body");
			assert.equal(params.mode, "queue");
			return { ok: true, value: { accepted: true } };
		},
	};
	const result = await dispatchRpc(
		{ id: 4, method: "session.prompt", params: { sessionId: "sess-9", text: "secret prompt body" } },
		{ upstream, deviceId: "dev-1", audit },
	);
	assert.equal(result.ok, true);
	assert.equal(audit.entries.length, 1);
	assert.equal(audit.entries[0].event, "rpc_write");
	assert.equal(audit.entries[0].deviceId, "dev-1");
	assert.deepEqual(audit.entries[0].detail, { method: "session.prompt", sessionId: "sess-9" });
	assert.equal(JSON.stringify(audit.entries[0]).includes("secret prompt body"), false);
});

test("session.history forwards beforeSeq and maxMessages to upstream", async () => {
	const upstream = {
		async history(params) {
			assert.equal(params.sessionId, "s-hist");
			assert.equal(params.beforeSeq, 42);
			assert.equal(params.maxMessages, 20);
			return { ok: true, value: { events: [{ seq: 41, event: { type: "user/message" } }], hasMore: true } };
		},
	};
	const result = await dispatchRpc(
		{
			id: 12,
			method: "session.history",
			params: { sessionId: "s-hist", beforeSeq: 42, maxMessages: 20 },
		},
		{ upstream, deviceId: "dev-1" },
	);
	assert.equal(result.ok, true);
	assert.equal(result.result.hasMore, true);
	assert.equal(result.result.events.length, 1);
});

test("session.prompt mode steer is forwarded to upstream", async () => {
	const upstream = {
		async prompt(params) {
			assert.equal(params.mode, "steer");
			assert.equal(params.text, "interrupt now");
			return { ok: true, value: { accepted: true } };
		},
	};
	const result = await dispatchRpc(
		{ id: 10, method: "session.prompt", params: { sessionId: "s1", mode: "steer", text: "interrupt now" } },
		{ upstream, deviceId: "dev-1" },
	);
	assert.equal(result.ok, true);
});

test("session.prompt unknown mode falls back to queue", async () => {
	const upstream = {
		async prompt(params) {
			assert.equal(params.mode, "queue");
			return { ok: true, value: { accepted: true } };
		},
	};
	const result = await dispatchRpc(
		{ id: 11, method: "session.prompt", params: { sessionId: "s1", mode: "whatever", text: "hello" } },
		{ upstream },
	);
	assert.equal(result.ok, true);
});

test("session.cancel and respond audit writes omit answer bodies", async () => {
	const audit = auditSink();
	const upstream = {
		async cancel(sessionId) {
			assert.equal(sessionId, "s1");
			return { ok: true, value: { accepted: true } };
		},
		async respond(input) {
			assert.equal(input.kind, "question");
			return { ok: true, value: { accepted: true } };
		},
	};
	const cancel = await dispatchRpc(
		{ id: 6, method: "session.cancel", params: { sessionId: "s1" } },
		{ upstream, deviceId: "dev-2", audit },
	);
	const respond = await dispatchRpc(
		{
			id: 7,
			method: "respond",
			params: { rpcId: "q-1", sessionId: "s1", answers: [{ id: "q", selected: ["yes"], custom: "classified" }] },
		},
		{ upstream, deviceId: "dev-2", audit },
	);
	assert.equal(cancel.ok, true);
	assert.equal(respond.ok, true);
	assert.equal(audit.entries.length, 2);
	assert.equal(
		audit.entries.every((entry) => entry.event === "rpc_write" && JSON.stringify(entry).includes("classified") === false),
		true,
	);
});
