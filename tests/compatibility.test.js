import assert from "node:assert/strict";
import test from "node:test";
import { resolveHostCompatibility } from "../lib/server/context.js";
import { apply, inject } from "../lib/server/index.js";
import { statusGetResult } from "../lib/shared/handshake.js";

function apiProxy() {
	return {
		sessions: {
			async list() { return { rpcId: "1", result: { ok: true, value: { items: [] } } }; },
			async history() { return { rpcId: "1", result: { ok: true, value: { events: [], hasMore: false } } }; },
			async prompt() { return { rpcId: "1", result: { ok: true, value: {} } }; },
			async cancel() { return { rpcId: "1", result: { ok: true, value: {} } }; },
		},
		events: { async *mux() {}, async *host() {} },
		async respond() {},
	};
}

test("host compatibility adapter accepts injected DSH services and reports their source", () => {
	const resolved = resolveHostCompatibility({
		logger: {},
		apiProxy: apiProxy(),
		webServer: { register() { return () => {}; } },
		effect() {},
	});
	assert.equal(resolved.apiProxy !== undefined, true);
	assert.equal(resolved.webServer !== undefined, true);
	assert.deepEqual({
		apiProxy: { available: true, source: "injected" },
		webServer: { available: true, source: "injected" },
	}, {
		apiProxy: resolved.diagnostics.apiProxy,
		webServer: resolved.diagnostics.webServer,
	});
	assert.equal(resolved.diagnostics.coreAbi, "dsh-mobile-remote/v1");
	assert.equal(resolved.diagnostics.verifiedBom.id, "dsh-0.1.1-rc.2");
	assert.equal(resolved.diagnostics.capabilities.webServer.state, "available");
	assert.equal(resolved.diagnostics.status, "healthy");
});

test("host compatibility adapter falls back to DSH's service lookup without assuming imports", () => {
	const proxy = apiProxy();
	const server = { register() { return () => {}; } };
	const resolved = resolveHostCompatibility({
		logger: {},
		get(name) { return name === "apiProxy" ? proxy : name === "webServer" ? server : undefined; },
		effect() {},
	});
	assert.deepEqual({
		apiProxy: { available: true, source: "lookup" },
		webServer: { available: true, source: "lookup" },
	}, {
		apiProxy: resolved.diagnostics.apiProxy,
		webServer: resolved.diagnostics.webServer,
	});
});

test("one optional service lookup failure does not hide later host capabilities", () => {
	const ownerRequestPolicy = { authorize() { return { authorized: false, reason: "test" }; }, diagnostics() { return []; } };
	const server = { register() { return () => {}; } };
	const resolved = resolveHostCompatibility({
		logger: {},
		get(name) {
			if (name === "apiProxy") throw new Error("service unavailable");
			if (name === "webServer") return server;
			if (name === "ownerRequestPolicy") return ownerRequestPolicy;
		},
		effect() {},
	});
	assert.equal(resolved.apiProxy, undefined);
	assert.equal(resolved.webServer, server);
	assert.equal(resolved.ownerRequestPolicy, ownerRequestPolicy);
});

test("host compatibility reports a missing apiProxy as a supported degraded capability", () => {
	const context = {
		logger: {},
		webServer: { register() { return () => {}; } },
		effect() {},
	};
	const resolved = resolveHostCompatibility(new Proxy(context, {
		get(target, property, receiver) {
			if (property === "apiProxy" || property === "ownerRequestPolicy") {
				throw new Error(`cannot get property "${String(property)}" without inject`);
			}
			return Reflect.get(target, property, receiver);
		},
	}));
	assert.equal(resolved.diagnostics.status, "degraded");
	assert.equal(resolved.diagnostics.capabilities.apiProxy.state, "missing");
	assert.equal(resolved.diagnostics.recommendations.length, 1);
	assert.equal(resolved.diagnostics.capabilities.webServer.state, "available");
});

test("only webServer is hard-injected and entry failures do not escape", async () => {
	assert.deepEqual(inject, ["webServer"]);
	const errors = [];
	await assert.doesNotReject(() => apply({
		logger: { error(message) { errors.push(message); } },
		effect() {},
	}, { port: "not-a-port" }));
	assert.equal(errors.length, 1);
});

test("status compatibility BOM remains explicit and finite", () => {
	const status = statusGetResult();
	assert.deepEqual(Object.keys(status).sort(), [
		"deviceScope",
		"dshVersion",
		"minCompatibleMobileVersion",
		"pluginVersion",
		"protocolVersion",
	]);
	assert.equal(status.dshVersion, "0.1.1-rc.2");
});
