import assert from "node:assert/strict";
import test from "node:test";
import {
	DISCLAIMER_VERSION,
	registerManagementRoutes,
	requireDisclaimerAccepted,
} from "../lib/server/routes.js";
import {
	createOwnerRequestPolicy,
	OWNER_CSRF_HEADER,
	OWNER_PROOF_HEADER,
} from "../lib/server/security.js";

function createHarness(overrides = {}) {
	const handlers = new Map();
	const auditEvents = [];
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
				activeDeviceCount: () => 1,
				revoke: () => null,
				devices: [
					{ deviceId: "a", createdAt: 1, lastSeenAt: 2, scope: "mobile" },
					{ deviceId: "b", createdAt: 1, lastSeenAt: 2, revokedAt: 3, scope: "mobile" },
				],
			},
			offers: {
				createOffer() {
					throw new Error("not used");
				},
				count: () => 0,
			},
			audit: {
				log(event) {
					auditEvents.push(event);
				},
			},
			ownerRequestPolicy,
			listening: () => true,
			currentBind: () => "127.0.0.1",
			port: () => 6879,
			async widen() {},
			advertise: () => ({
				endpoint: "ws://127.0.0.1/m/ws",
				pageUrl: "http://127.0.0.1/m",
				candidates: ["127.0.0.1"],
			}),
			tunnel: {
				snapshot: () => ({ running: false, kind: null, url: null, binaryOk: true }),
				async start() {
					return "https://example.trycloudflare.com";
				},
				async stop() {},
			},
			relay: {
				snapshot: () => ({
					running: false,
					kind: null,
					url: null,
					hostConnected: false,
					binaryOk: true,
					hasToken: false,
				}),
				async start() {
					throw new Error("not used");
				},
				async stop() {},
				createInvite: () => "invite",
				advertise: () => ({
					endpoint: "wss://example.com/ws",
					pageUrl: "https://example.com/m/",
					candidates: ["example.com"],
				}),
				async putInvite() {},
			},
			async installCloudflared() {
				throw new Error("not used");
			},
			...overrides,
		},
	);
	handlers.auditEvents = auditEvents;
	return handlers;
}

function response() {
	return {
		status: 0,
		body: "",
		writeHead(status) {
			this.status = status;
		},
		setHeader() {},
		end(body) {
			this.body = body ?? "";
		},
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
			if (event === "end")
				queueMicrotask(() => {
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

const mutateHeaders = {
	...proxyHeaders,
	[OWNER_CSRF_HEADER]: "csrf-proof-secret",
	"content-type": "application/json",
	"x-dsh-mobile-remote": "1",
};

test("requireDisclaimerAccepted is strict true only", () => {
	assert.equal(requireDisclaimerAccepted({ disclaimerAccepted: true }), true);
	assert.equal(requireDisclaimerAccepted({ disclaimerAccepted: "true" }), false);
	assert.equal(requireDisclaimerAccepted({}), false);
	assert.equal(requireDisclaimerAccepted(null), false);
});

test("GET status includes connectionDiagnostics.schemaVersion === 1", async () => {
	const handlers = createHarness();
	const res = response();
	await handlers.get("/api/mobile-remote/status")(request({ headers: proxyHeaders }), res);
	assert.equal(res.status, 200);
	const body = JSON.parse(res.body);
	assert.equal(body.connectionDiagnostics.schemaVersion, 1);
	assert.equal(typeof body.connectionDiagnostics.pluginVersion, "string");
	assert.equal(body.connectionDiagnostics.protocolVersion, 1);
	assert.ok(Array.isArray(body.connectionDiagnostics.networkCandidates));
	for (const row of body.connectionDiagnostics.networkCandidates) {
		assert.deepEqual(Object.keys(row).sort(), ["address", "kind"]);
	}
	assert.equal(body.connectionDiagnostics.cloudflared.pinnedRelease, "2026.8.2");
	assert.equal(body.connectionDiagnostics.disclaimer.requiredVersion, DISCLAIMER_VERSION);
	if (body.connectionDiagnostics.tunnel?.urlHost !== undefined) {
		assert.equal(body.connectionDiagnostics.tunnel.urlHost === null || !String(body.connectionDiagnostics.tunnel.urlHost).includes("://"), true);
	}
});

test("POST tunnel start without disclaimerAccepted → 400 disclaimer_required", async () => {
	const handlers = createHarness();
	const res = response();
	await handlers.get("/api/mobile-remote/tunnel")(
		request({
			method: "POST",
			headers: mutateHeaders,
			body: { action: "start", kind: "cloudflare-quick" },
		}),
		res,
	);
	assert.equal(res.status, 400);
	const body = JSON.parse(res.body);
	assert.equal(body.error.code, "disclaimer_required");
	assert.ok(handlers.auditEvents.some((event) => event.event === "tunnel_start_rejected"));
});

test("POST tunnel start with disclaimerAccepted proceeds and audits version", async () => {
	const handlers = createHarness();
	const res = response();
	await handlers.get("/api/mobile-remote/tunnel")(
		request({
			method: "POST",
			headers: mutateHeaders,
			body: { action: "start", kind: "cloudflare-quick", disclaimerAccepted: true },
		}),
		res,
	);
	assert.equal(res.status, 200);
	const body = JSON.parse(res.body);
	assert.equal(body.ok, true);
	assert.equal(body.url, "https://example.trycloudflare.com");
	const start = handlers.auditEvents.find((event) => event.event === "tunnel_start");
	assert.ok(start);
	assert.equal(start.detail.disclaimerAccepted, true);
	assert.equal(start.detail.disclaimerVersion, DISCLAIMER_VERSION);
});

test("POST tunnel start maps BinaryUntrustedError to binary-untrusted", async () => {
	const { BinaryUntrustedError } = await import("../lib/server/tunnel.js");
	const handlers = createHarness({
		tunnel: {
			snapshot: () => ({ running: false, kind: null, url: null, binaryOk: false }),
			async start() {
				throw new BinaryUntrustedError("untrusted");
			},
			async stop() {},
		},
	});
	const res = response();
	await handlers.get("/api/mobile-remote/tunnel")(
		request({
			method: "POST",
			headers: mutateHeaders,
			body: { action: "start", kind: "cloudflare-quick", disclaimerAccepted: true },
		}),
		res,
	);
	assert.equal(res.status, 500);
	const body = JSON.parse(res.body);
	assert.equal(body.error.code, "binary-untrusted");
});
