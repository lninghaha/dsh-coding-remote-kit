import assert from "node:assert/strict";
import test from "node:test";
import { registerManagementRoutes } from "../lib/server/routes.js";
import {
	createOwnerRequestPolicy,
	OWNER_CSRF_HEADER,
	OWNER_PROOF_HEADER,
} from "../lib/server/security.js";

function createHarness() {
	const handlers = new Map();
	const ownerRequestPolicy = createOwnerRequestPolicy({
		trustedProxy: {
			peers: ["127.0.0.1"],
			origins: ["https://gui.example.com"],
			ownerProof: "owner-proof-secret",
			csrfToken: "csrf-proof-secret",
		},
	});
	registerManagementRoutes(
		{
			register(route) {
				handlers.set(route.path, route.handler);
				return () => undefined;
			},
		},
		{
			logger: { warn() {}, info() {} },
			now: () => 0,
			publicKeyB64: "pk",
			offerTtlMs: 1000,
			registry: {
				networkReach: "this-computer",
				activeDeviceCount: () => 0,
				revoke: () => null,
				devices: [],
			},
			offers: { createOffer() { throw new Error("not used"); } },
			audit: { log() {} },
			ownerRequestPolicy,
			listening: () => true,
			currentBind: () => "127.0.0.1",
			port: () => 6879,
			async widen() {},
			advertise: () => ({ endpoint: "ws://127.0.0.1/m/ws", pageUrl: "http://127.0.0.1/m", candidates: ["127.0.0.1"] }),
			tunnel: {
				snapshot: () => ({ running: false, kind: null, url: null, binaryOk: true }),
				async start() { throw new Error("not used"); },
				async stop() {},
			},
			relay: {
				snapshot: () => ({ running: false, kind: null, url: null, hostConnected: false, binaryOk: true, hasToken: false }),
				async start() { throw new Error("not used"); },
				async stop() {},
				createInvite: () => "invite",
				advertise: () => ({ endpoint: "wss://example.com/ws", pageUrl: "https://example.com/m/", candidates: ["example.com"] }),
				async putInvite() {},
			},
			async installCloudflared() { throw new Error("not used"); },
		},
	);
	return handlers;
}

function response() {
	return {
		status: 0,
		body: "",
		writeHead(status) { this.status = status; },
		setHeader() {},
		end(body) { this.body = body ?? ""; },
	};
}

function request({ method = "GET", remoteAddress = "127.0.0.1", headers = {}, body } = {}) {
	const listeners = {};
	return {
		method,
		socket: { remoteAddress },
		headers,
		on(event, callback) {
			listeners[event] = callback;
			if (event === "end") queueMicrotask(() => {
				if (body !== undefined) listeners.data?.(Buffer.from(JSON.stringify(body)));
				listeners.end?.();
			});
			return this;
		},
		destroy() {},
	};
}

const proxyHeaders = {
	host: "gui.example.com",
	origin: "https://gui.example.com",
	"sec-fetch-site": "same-origin",
	[OWNER_PROOF_HEADER]: "owner-proof-secret",
};

test("remote status reports trusted-proxy access only after owner proof", async () => {
	const handlers = createHarness();
	const denied = response();
	await handlers.get("/api/mobile-remote/status")(
		request({ headers: { host: "gui.example.com", origin: "https://gui.example.com", "sec-fetch-site": "same-origin" } }),
		denied,
	);
	assert.equal(denied.status, 403);

	const allowed = response();
	await handlers.get("/api/mobile-remote/status")(request({ headers: proxyHeaders }), allowed);
	assert.equal(allowed.status, 200);
	assert.equal(JSON.parse(allowed.body).accessMode, "trusted-https-proxy");
});

test("remote mutations need independent CSRF proof and the plugin mutation marker", async () => {
	const handlers = createHarness();
	for (const headers of [
		{ ...proxyHeaders, "content-type": "application/json", "x-dsh-mobile-remote": "1" },
		{ ...proxyHeaders, [OWNER_CSRF_HEADER]: "csrf-proof-secret", "content-type": "application/json" },
	]) {
		const denied = response();
		await handlers.get("/api/mobile-remote/revoke")(
			request({ method: "POST", headers, body: { deviceId: "device-1" } }),
			denied,
		);
		assert.equal(denied.status, 403);
	}

	const passedGuard = response();
	await handlers.get("/api/mobile-remote/revoke")(
		request({
			method: "POST",
			headers: {
				...proxyHeaders,
				[OWNER_CSRF_HEADER]: "csrf-proof-secret",
				"content-type": "application/json",
				"x-dsh-mobile-remote": "1",
			},
			body: { deviceId: "device-1" },
		}),
		passedGuard,
	);
	assert.equal(passedGuard.status, 404);
});

test("forwarded headers and cross-site metadata never replace the real proxy contract", async () => {
	const handlers = createHarness();
	for (const candidate of [
		request({
			remoteAddress: "192.0.2.24",
			headers: { ...proxyHeaders, "x-forwarded-for": "127.0.0.1", "x-forwarded-host": "gui.example.com" },
		}),
		request({ headers: { ...proxyHeaders, "sec-fetch-site": "cross-site" } }),
	]) {
		const denied = response();
		await handlers.get("/api/mobile-remote/status")(candidate, denied);
		assert.equal(denied.status, 403);
	}
});

test("a configured loopback proxy peer cannot fall back to local authorization", async () => {
	const handlers = createHarness();
	const denied = response();
	await handlers.get("/api/mobile-remote/status")(
		request({ headers: { host: "127.0.0.1:3080" } }),
		denied,
	);
	assert.equal(denied.status, 403);
});
