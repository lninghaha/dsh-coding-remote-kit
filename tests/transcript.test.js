import assert from "node:assert/strict";
import test from "node:test";
import { utf8Encode } from "../lib/shared/base64.js";
import { buildTranscript, encodeTranscriptMessage, encodeTranscriptValue, tlv } from "../lib/shared/transcript.js";

function hello() {
	return {
		type: "e2ee_hello",
		v: 1,
		clientPublicKeyB64: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
		clientNonceB64: "HyA1NDc6Ozw9Pj9AQUJDREVGR0hJSktMTU5PUFFSU1Q=",
		capabilities: { framing: [1], payloadKinds: ["text", "binary"] },
		context: { protocol: "dshmr-e2ee", initiator: "mobile", responder: "plugin", transport: "direct" },
	};
}

function ready() {
	return {
		type: "e2ee_ready",
		v: 1,
		serverPublicKeyB64: "VldYWVpbXF1eX2BhYmNkZWZnaGlqa2xtbm9wcXJzdHV2dw==",
		clientNonceB64: "HyA1NDc6Ozw9Pj9AQUJDREVGR0hJSktMTU5PUFFSU1Q=",
		serverNonceB64: "eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpc=",
		selection: { framing: [1], payloadKinds: ["text", "binary"] },
		context: { protocol: "dshmr-e2ee", initiator: "mobile", responder: "plugin", transport: "direct" },
	};
}

function toHex(bytes) {
	return Buffer.from(bytes).toString("hex");
}

test("transcript is deterministic for identical input", () => {
	const a = buildTranscript(hello(), ready());
	const b = buildTranscript(hello(), ready());
	assert.deepEqual(a, b);
	assert.equal(toHex(a), toHex(b));
});

test("transcript begins with the domain prefix", () => {
	const transcript = buildTranscript(hello(), ready());
	const domain = utf8Encode("dshmr-e2ee/v1/transcript");
	assert.equal(toHex(transcript.slice(0, domain.length)), toHex(domain));
});

test("nested object keys are encoded in canonical (alphabetical) order", () => {
	const a = encodeTranscriptValue({ b: 1, a: 2, c: 3 });
	const b = encodeTranscriptValue({ c: 3, a: 2, b: 1 });
	assert.equal(toHex(a), toHex(b));
});

test("message fields are encoded in fixed order regardless of key order", () => {
	const forward = { type: "x", v: 1, b: "y", a: "z" };
	const backward = { a: "z", v: 1, type: "x", b: "y" };
	// encodeTranscriptMessage sorts extras alphabetically, but the fixed-order
	// prefix (type, v) is stable; the two objects still canonicalize to the
	// same bytes when all keys are present in both.
	assert.equal(
		toHex(encodeTranscriptMessage(forward, ["type", "v"])),
		toHex(encodeTranscriptMessage(backward, ["type", "v"])),
	);
});

test("tlv length prefix is little-endian", () => {
	const framed = tlv(new Uint8Array([0x61]));
	assert.deepEqual(Array.from(framed), [1, 0, 0, 0, 0x61]);
});

test("arrays encode elements in order", () => {
	const a = encodeTranscriptValue(["text", "binary"]);
	const b = encodeTranscriptValue(["binary", "text"]);
	assert.notEqual(toHex(a), toHex(b));
});
