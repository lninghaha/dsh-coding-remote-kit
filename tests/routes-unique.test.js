import assert from "node:assert/strict";
import test from "node:test";
import { registerManagementRoutes } from "../lib/server/routes.js";

function stubDeps() {
	return {
		logger: { warn() {}, info() {} },
		now: () => 0,
		publicKeyB64: "pk",
		offerTtlMs: 1000,
		registry: { networkReach: "this-computer", activeDeviceCount: () => 0, revoke() { return null; } },
		offers: { createOffer() { return { offerId: "o" }; } },
		audit: { log() {} },
		trustedHosts: [],
		listening: () => true,
		currentBind: () => "127.0.0.1",
		port: () => 6879,
		async widen() {},
		advertise: () => ({ endpoint: "ws://127.0.0.1/m/ws", pageUrl: "http://127.0.0.1/m", candidates: ["127.0.0.1"] }),
		tunnel: {
			snapshot: () => ({ running: false, kind: null, url: null, binaryOk: false }),
			async start() { return "https://example.trycloudflare.com"; },
			async stop() {},
		},
		relay: {
			snapshot: () => ({ running: false, kind: null, url: null, hostConnected: false, binaryOk: true, hasToken: false }),
			async start() { return "https://example.com"; },
			async stop() {},
			createInvite: () => "invite",
			advertise: () => ({ endpoint: "wss://example.com/v1/phone/h?invite=i", pageUrl: "https://example.com/m/", candidates: ["example.com"] }),
			async putInvite() {},
		},
		async installCloudflared() { return { asset: "cloudflared-linux-amd64", path: "/tmp/cloudflared" }; },
	};
}

test("management exact paths are unique (DSH webServer keys by path, not method)", () => {
	const paths = [];
	const webServer = {
		register(route) {
			if (paths.includes(route.path)) {
				throw new Error(`duplicate exact route ${route.path}`);
			}
			paths.push(route.path);
			return () => {};
		},
	};
	registerManagementRoutes(webServer, stubDeps());
	assert.deepEqual(new Set(paths).size, paths.length);
	assert.ok(paths.includes("/api/mobile-remote/tunnel"));
	assert.ok(paths.includes("/api/mobile-remote/cloudflared"));
	assert.ok(paths.includes("/api/mobile-remote/relay"));
	assert.equal(paths.filter((path) => path === "/api/mobile-remote/tunnel").length, 1);
	assert.equal(paths.filter((path) => path === "/api/mobile-remote/cloudflared").length, 1);
	assert.equal(paths.filter((path) => path === "/api/mobile-remote/relay").length, 1);
});
