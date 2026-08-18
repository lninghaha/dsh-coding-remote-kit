import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "../lib/server/crypto.js";
import { DeviceRegistry } from "../lib/server/registry.js";
import { devicesResponseBody, registerManagementRoutes, serializeDevice } from "../lib/server/routes.js";
import { utf8Encode } from "../lib/shared/base64.js";

test("serializeDevice never includes tokenHash", () => {
	const device = {
		deviceId: "dev-1",
		tokenHash: "should-not-leak",
		phonePublicKeyB64: "also-not-in-public-row",
		scope: "mobile",
		createdAt: 10,
		lastSeenAt: 20,
		revokedAt: 30,
	};
	const publicDevice = serializeDevice(device);
	assert.deepEqual(publicDevice, {
		deviceId: "dev-1",
		createdAt: 10,
		lastSeenAt: 20,
		revokedAt: 30,
		scope: "mobile",
	});
	const encoded = JSON.stringify(publicDevice);
	assert.equal(encoded.includes("tokenHash"), false);
	assert.equal(encoded.includes("should-not-leak"), false);
	assert.equal(encoded.includes("phonePublicKey"), false);
});

test("GET /api/mobile-remote/devices omits tokenHash", async () => {
	const dir = mkdtempSync(join(tmpdir(), "dshmr-devices-"));
	const registry = new DeviceRegistry(dir);
	registry.upsertDevice({ tokenHash: sha256Hex(utf8Encode("device-token-value")) }, 1000);
	const body = devicesResponseBody(registry);
	assert.equal(body.devices.length, 1);
	assert.equal(body.devices[0].tokenHash, undefined);
	assert.equal(JSON.stringify(body).includes("tokenHash"), false);
	assert.equal(JSON.stringify(body).includes("device-token-value"), false);

	const handlers = new Map();
	const webServer = {
		register(route) {
			handlers.set(route.path, route.handler);
			return () => {};
		},
	};
	registerManagementRoutes(webServer, {
		logger: { warn() {}, info() {} },
		now: () => 2000,
		publicKeyB64: "pk",
		offerTtlMs: 1000,
		registry,
		offers: { createOffer() { return { offerId: "o" }; } },
		audit: { log() {} },
		listening: () => true,
		currentBind: () => "127.0.0.1",
		port: () => 6879,
		async widen() {},
		advertise: () => ({ endpoint: "ws://127.0.0.1/m/ws", pageUrl: "http://127.0.0.1/m", candidates: ["127.0.0.1"] }),
	});

	const chunks = [];
	const response = {
		status: 0,
		body: "",
		writeHead(status) {
			this.status = status;
		},
		end(body) {
			this.body = body ?? "";
		},
		setHeader() {},
	};
	const request = {
		method: "GET",
		socket: { remoteAddress: "127.0.0.1" },
		headers: { host: "127.0.0.1:3080" },
		on() {
			return this;
		},
	};
	await handlers.get("/api/mobile-remote/devices")(request, response);
	assert.equal(response.status, 200);
	const parsed = JSON.parse(response.body);
	assert.equal(parsed.devices.length, 1);
	assert.equal(parsed.devices[0].deviceId, registry.devices[0].deviceId);
	assert.equal(Object.hasOwn(parsed.devices[0], "tokenHash"), false);
	assert.equal(response.body.includes("tokenHash"), false);
	void chunks;
});
