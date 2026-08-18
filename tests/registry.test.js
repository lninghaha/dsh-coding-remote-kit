import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { constantTimeEqualHex, sha256Hex } from "../lib/server/crypto.js";
import { loadOrCreateServerKey } from "../lib/server/keys.js";
import { AuditLogger, DeviceRegistry, OfferRegistry } from "../lib/server/registry.js";
import { ensureStorageDir } from "../lib/server/storage.js";
import { utf8Encode } from "../lib/shared/base64.js";

const base = mkdtempSync(join(tmpdir(), "dshmr-registry-"));
process.env.DSH_HOME = join(base, "home");

function mode(path) {
	return statSync(path).mode & 0o777;
}

test("device registry create / lookup / revoke / persist-reload", () => {
	const dir = ensureStorageDir();
	const registry = new DeviceRegistry(dir);
	const tokenHash = sha256Hex(utf8Encode("my-device-token"));
	const device = registry.upsertDevice({ tokenHash }, 1000);
	assert.ok(device.deviceId.length > 0);
	assert.equal(registry.findByTokenHash(tokenHash)?.deviceId, device.deviceId);
	assert.equal(registry.findByTokenHash(sha256Hex(utf8Encode("other-token"))), null);
	assert.equal(registry.activeDeviceCount(), 1);
	assert.equal(registry.hasActiveDevice(), true);

	registry.revoke(device.deviceId, 2000);
	assert.equal(registry.activeDeviceCount(), 0);
	assert.equal(registry.findByTokenHash(tokenHash)?.revokedAt, 2000);

	const reloaded = new DeviceRegistry(dir);
	assert.equal(reloaded.findByTokenHash(tokenHash)?.deviceId, device.deviceId);
	assert.equal(reloaded.activeDeviceCount(), 0);
});

test("file permissions 0600, directory 0700", () => {
	const dir = ensureStorageDir();
	loadOrCreateServerKey(dir);
	const registry = new DeviceRegistry(dir);
	registry.upsertDevice({ tokenHash: sha256Hex(utf8Encode("x")) }, 1);
	assert.equal(mode(dir), 0o700);
	assert.equal(mode(join(dir, "server-key.json")), 0o600);
	assert.equal(mode(join(dir, "devices.json")), 0o600);
});

test("audit appends JSONL and never includes tokens", () => {
	const dir = ensureStorageDir();
	const audit = new AuditLogger(dir);
	audit.log({ event: "auth_failed", detail: { reason: "bad_auth" } }, 5);
	const lines = readFileSync(join(dir, "audit.jsonl"), "utf8").trim().split("\n");
	assert.equal(lines.length, 1);
	const record = JSON.parse(lines[0]);
	assert.equal(record.ts, 5);
	assert.equal(record.event, "auth_failed");
	assert.equal(record.detail.reason, "bad_auth");
	assert.equal(record.deviceToken, undefined);
	assert.equal(record.secretKey, undefined);
});

test("constant-time hex comparison path (timingSafeEqual) works", () => {
	const a = sha256Hex(utf8Encode("alpha"));
	const b = sha256Hex(utf8Encode("beta"));
	assert.equal(constantTimeEqualHex(a, a), true);
	assert.equal(constantTimeEqualHex(a, b), false);
});

test("offer registry enforces one-time consumption and a 5-offer cap", () => {
	const offers = new OfferRegistry();
	const offer = offers.createOffer({ endpoint: "ws://x", pageUrl: "http://x", publicKeyB64: "p", ttlMs: 10000, now: 1000 });
	assert.equal(offers.count(), 1);
	assert.equal(offers.consumeByToken(offer.deviceToken, 2000)?.offerId, offer.offerId);
	assert.equal(offers.consumeByToken(offer.deviceToken, 2000), null);

	const capped = new OfferRegistry();
	const first = capped.createOffer({ endpoint: "e", pageUrl: "p", publicKeyB64: "k", ttlMs: 10000, now: 1 });
	for (let i = 0; i < 5; i += 1) {
		capped.createOffer({ endpoint: "e", pageUrl: "p", publicKeyB64: "k", ttlMs: 10000, now: 1 });
	}
	assert.equal(capped.count(), 5);
	assert.equal(capped.consumeByToken(first.deviceToken, 2), null);
});
