import assert from "node:assert/strict";
import test from "node:test";
import nacl from "tweetnacl";
import { generateClientKeyPair, MobileE2eeSession } from "../lib/mobile/e2ee.js";
import { base64Encode } from "../lib/shared/base64.js";
import { validateAuth } from "../lib/shared/handshake.js";
import { DIRECTION_MOBILE_TO_SERVER, PAYLOAD_KIND_TEXT } from "../lib/shared/constants.js";
import { open } from "../lib/shared/frame.js";
import { ServerHandshake } from "../lib/server/e2ee.js";

const deviceToken = "pairing-token-for-handshake-test";

test("process-level 4-step handshake reaches key agreement", () => {
	const serverKeyPair = nacl.box.keyPair();
	const mobileKeyPair = generateClientKeyPair();
	const mobile = new MobileE2eeSession({
		clientSecretKey: mobileKeyPair.secretKey,
		clientPublicKey: mobileKeyPair.publicKey,
		pinnedPublicKeyB64: base64Encode(serverKeyPair.publicKey),
	});

	const server = new ServerHandshake(serverKeyPair, () => ({ kind: "ok", device: { deviceId: "device-1" } }));

	// Step 1: hello
	const started = server.start(mobile.hello);
	assert.equal(started.ok, true);

	// Step 2: ready (mobile pin-checks + derives)
	const readyResult = mobile.receiveReady(started.ready);
	assert.equal(readyResult.ok, true);

	// Step 3: auth
	const auth = mobile.auth(deviceToken);
	const finished = server.finish(auth);
	assert.equal(finished.ok, true);

	// Step 4: authenticated
	const authenticated = mobile.receiveAuthenticated(finished.authenticated);
	assert.equal(authenticated.ok, true);
	assert.equal(authenticated.status.protocolVersion, 1);
	assert.equal(authenticated.status.minCompatibleMobileVersion, 1);

	// The derived keys agree: mobile-sealed frames open with server keys.
	const payload = new Uint8Array([9, 8, 7]);
	const sealed = mobile.sealOut(payload);
	const opened = open(
		sealed,
		finished.keys.mobileToServerKey,
		finished.keys.sessionId,
		DIRECTION_MOBILE_TO_SERVER,
		PAYLOAD_KIND_TEXT,
		0,
	);
	assert.deepEqual(opened, payload);
});

test("pinned public key mismatch aborts without deriving keys", () => {
	const serverKeyPair = nacl.box.keyPair();
	const otherKeyPair = nacl.box.keyPair();
	const mobileKeyPair = generateClientKeyPair();
	const mobile = new MobileE2eeSession({
		clientSecretKey: mobileKeyPair.secretKey,
		clientPublicKey: mobileKeyPair.publicKey,
		pinnedPublicKeyB64: base64Encode(otherKeyPair.publicKey),
	});
	const server = new ServerHandshake(serverKeyPair, () => ({ kind: "ok", device: { deviceId: "device-1" } }));
	const started = server.start(mobile.hello);
	assert.equal(started.ok, true);

	const result = mobile.receiveReady(started.ready);
	assert.equal(result.ok, false);
	assert.equal(result.reason, "pinned-key-mismatch");

	// No keys were derived: both the auth builder and the sealer must throw.
	assert.throws(() => mobile.auth(deviceToken), /handshake not ready/);
	assert.throws(() => mobile.sealOut(new Uint8Array([1])), /session keys are not ready/);
});

test("invalid / tampered hello is rejected by the server", () => {
	const serverKeyPair = nacl.box.keyPair();
	const server = new ServerHandshake(serverKeyPair, () => ({ kind: "ok", device: { deviceId: "d" } }));
	assert.equal(server.start({ type: "e2ee_hello" }).ok, false);
	assert.equal(server.start({ type: "e2ee_hello", v: 1, extra: true }).ok, false);
});

test("auth identity fields are optional, normalized, and reject control characters", () => {
	const serverKeyPair = nacl.box.keyPair();
	const mobileKeyPair = generateClientKeyPair();
	const mobile = new MobileE2eeSession({
		clientSecretKey: mobileKeyPair.secretKey,
		clientPublicKey: mobileKeyPair.publicKey,
		pinnedPublicKeyB64: base64Encode(serverKeyPair.publicKey),
	});
	const server = new ServerHandshake(serverKeyPair, () => ({ kind: "ok", device: { deviceId: "device-identity" } }));
	const started = server.start(mobile.hello);
	assert.equal(started.ok, true);
	assert.equal(mobile.receiveReady(started.ready).ok, true);

	const legacy = mobile.auth(deviceToken);
	assert.deepEqual(Object.keys(legacy).sort(), ["deviceToken", "transcriptHashB64", "type", "v"]);
	assert.equal(validateAuth(legacy).deviceName, undefined);
	const named = mobile.auth(deviceToken, {
		deviceName: "  Pocket   DSH  ",
		clientMetadata: { mobileProtocolVersion: 1, locale: "zh-CN", platform: "Android" },
	});
	assert.equal(named.deviceName, "Pocket DSH");
	assert.deepEqual(named.clientMetadata, { mobileProtocolVersion: 1, locale: "zh-CN", platform: "Android" });
	assert.equal(server.finish(named).ok, true);
	assert.throws(() => mobile.auth(deviceToken, { deviceName: "Pocket\u0000DSH" }), /control characters/);
	assert.throws(() => validateAuth({ ...legacy, deviceName: 42 }), /deviceName must be a string/);
	assert.throws(() => validateAuth({ ...legacy, extra: true }), /unexpected e2ee_auth keys/);
	assert.throws(
		() => validateAuth({ ...legacy, clientMetadata: { mobileProtocolVersion: 1, locale: "en", extra: true } }),
		/unexpected keys/,
	);
});
