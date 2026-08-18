import assert from "node:assert/strict";
import test from "node:test";
import { DIRECTION_MOBILE_TO_SERVER, DIRECTION_SERVER_TO_MOBILE, PAYLOAD_KIND_BINARY, PAYLOAD_KIND_TEXT } from "../lib/shared/constants.js";
import { open, seal } from "../lib/shared/frame.js";

const key = new Uint8Array(32).fill(0x11);
const sessionId = new Uint8Array(32).fill(0x22);
const payload = new Uint8Array([1, 2, 3, 4, 5]);

test("seal/open round-trips in both directions", () => {
	const sealed = seal(key, sessionId, DIRECTION_MOBILE_TO_SERVER, PAYLOAD_KIND_TEXT, 0, payload);
	const opened = open(sealed, key, sessionId, DIRECTION_MOBILE_TO_SERVER, PAYLOAD_KIND_TEXT, 0);
	assert.deepEqual(opened, payload);

	const sealedSrv = seal(key, sessionId, DIRECTION_SERVER_TO_MOBILE, PAYLOAD_KIND_TEXT, 7, payload);
	const openedSrv = open(sealedSrv, key, sessionId, DIRECTION_SERVER_TO_MOBILE, PAYLOAD_KIND_TEXT, 7);
	assert.deepEqual(openedSrv, payload);
});

test("counter reorder/mismatch yields null", () => {
	const sealed = seal(key, sessionId, DIRECTION_MOBILE_TO_SERVER, PAYLOAD_KIND_TEXT, 3, payload);
	assert.equal(open(sealed, key, sessionId, DIRECTION_MOBILE_TO_SERVER, PAYLOAD_KIND_TEXT, 4), null);
	assert.equal(open(sealed, key, sessionId, DIRECTION_MOBILE_TO_SERVER, PAYLOAD_KIND_TEXT, 2), null);
});

test("direction / kind mismatch yields null", () => {
	const sealed = seal(key, sessionId, DIRECTION_MOBILE_TO_SERVER, PAYLOAD_KIND_TEXT, 0, payload);
	assert.equal(open(sealed, key, sessionId, DIRECTION_SERVER_TO_MOBILE, PAYLOAD_KIND_TEXT, 0), null);
	assert.equal(open(sealed, key, sessionId, DIRECTION_MOBILE_TO_SERVER, PAYLOAD_KIND_BINARY, 0), null);
});

test("wrong key yields null", () => {
	const sealed = seal(key, sessionId, DIRECTION_MOBILE_TO_SERVER, PAYLOAD_KIND_TEXT, 0, payload);
	const wrongKey = new Uint8Array(32).fill(0x99);
	assert.equal(open(sealed, wrongKey, sessionId, DIRECTION_MOBILE_TO_SERVER, PAYLOAD_KIND_TEXT, 0), null);
});

test("tampered ciphertext yields null", () => {
	const sealed = seal(key, sessionId, DIRECTION_MOBILE_TO_SERVER, PAYLOAD_KIND_TEXT, 0, payload);
	sealed[sealed.length - 1] ^= 0xff;
	assert.equal(open(sealed, key, sessionId, DIRECTION_MOBILE_TO_SERVER, PAYLOAD_KIND_TEXT, 0), null);
});
