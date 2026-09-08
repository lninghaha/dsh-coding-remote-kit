import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nacl from "tweetnacl";
import { generateClientKeyPair, MobileE2eeSession } from "../lib/mobile/e2ee.js";
import { base64Encode } from "../lib/shared/base64.js";
import { CLOSE_AUTH_FAILED } from "../lib/shared/constants.js";
import { DEVICE_IDLE_TTL_MS } from "../lib/shared/constants.js";
import { resolveDeviceToken, ServerHandshake } from "../lib/server/e2ee.js";
import { AuditLogger, DeviceRegistry, OfferRegistry } from "../lib/server/registry.js";
import { ensureStorageDir } from "../lib/server/storage.js";

const base = mkdtempSync(join(tmpdir(), "dshmr-auth-"));
process.env.DSH_HOME = join(base, "home");

function deps() {
	const dir = ensureStorageDir();
	return {
		dir,
		registry: new DeviceRegistry(dir),
		offers: new OfferRegistry(),
		audit: new AuditLogger(dir),
	};
}

test("unknown / wrong token → bad_auth", () => {
	const d = deps();
	const result = resolveDeviceToken("no-such-token", { ...d, now: () => 1000 });
	assert.equal(result.kind, "bad_auth");
});

test("expired offer → bad_auth", () => {
	const d = deps();
	const { offer } = d.offers.createOffer({ endpoint: "e", pageUrl: "p", publicKeyB64: "k", ttlMs: 1000, now: 1000 });
	const result = resolveDeviceToken(offer.deviceToken, { ...d, now: () => 5000 });
	assert.equal(result.kind, "bad_auth");
});

test("offer consumed twice → bad_auth", () => {
	const d = deps();
	const { offer } = d.offers.createOffer({ endpoint: "e", pageUrl: "p", publicKeyB64: "k", ttlMs: 100000, now: 1000 });
	assert.ok(d.offers.consumeByToken(offer.deviceToken, 2000));
	assert.equal(d.offers.consumeByToken(offer.deviceToken, 2000), null);
	const result = resolveDeviceToken(offer.deviceToken, { ...d, now: () => 2000 });
	assert.equal(result.kind, "bad_auth");
});

test("revoked device → unauthorized", () => {
	const d = deps();
	const { offer } = d.offers.createOffer({ endpoint: "e", pageUrl: "p", publicKeyB64: "k", ttlMs: 100000, now: 1000 });
	const first = resolveDeviceToken(offer.deviceToken, { ...d, now: () => 2000 });
	assert.equal(first.kind, "ok");
	d.registry.revoke(first.device.deviceId, 3000);
	const second = resolveDeviceToken(offer.deviceToken, { ...d, now: () => 4000 });
	assert.equal(second.kind, "unauthorized");
});

test("successful authentication refreshes idle clock but revoked and idle devices never revive", () => {
	const d = deps();
	const { offer } = d.offers.createOffer({ endpoint: "e", pageUrl: "p", publicKeyB64: "k", ttlMs: DEVICE_IDLE_TTL_MS * 2, now: 1 });
	const first = resolveDeviceToken(offer.deviceToken, { ...d, now: () => 10 });
	assert.equal(first.kind, "ok");
	const refreshed = resolveDeviceToken(offer.deviceToken, { ...d, now: () => 20 });
	assert.equal(refreshed.kind, "ok");
	assert.equal(d.registry.findById(first.device.deviceId)?.lastSeenAt, 20);
	const idle = resolveDeviceToken(offer.deviceToken, { ...d, now: () => 20 + DEVICE_IDLE_TTL_MS + 1 });
	assert.equal(idle.kind, "unauthorized");
	assert.notEqual(d.registry.findById(first.device.deviceId)?.revokedAt, undefined);
	const revoked = resolveDeviceToken(offer.deviceToken, { ...d, now: () => 30 + DEVICE_IDLE_TTL_MS });
	assert.equal(revoked.kind, "unauthorized");
});

test("ServerHandshake maps a bad token to bad_auth and close code 4001", () => {
	const d = deps();
	const serverKeyPair = nacl.box.keyPair();
	const mobileKeyPair = generateClientKeyPair();
	const mobile = new MobileE2eeSession({
		clientSecretKey: mobileKeyPair.secretKey,
		clientPublicKey: mobileKeyPair.publicKey,
		pinnedPublicKeyB64: base64Encode(serverKeyPair.publicKey),
	});
	const server = new ServerHandshake(serverKeyPair, (token) => resolveDeviceToken(token, d));
	const started = server.start(mobile.hello);
	assert.equal(started.ok, true);
	mobile.receiveReady(started.ready);
	const auth = mobile.auth("wrong-token");
	const result = server.finish(auth);
	assert.equal(result.ok, false);
	assert.equal(result.code, "bad_auth");
	assert.equal(CLOSE_AUTH_FAILED, 4001);
});
