import assert from "node:assert/strict";
import test from "node:test";
import nacl from "tweetnacl";
import { deriveSessionKeysNode } from "../lib/server/crypto.js";
import { deriveSessionKeys } from "../lib/shared/hkdf.js";

function rep(value) {
	return new Uint8Array(32).fill(value);
}

const clientSecret = rep(0x01);
const serverSecret = rep(0x02);
const clientNonce = rep(0x03);
const serverNonce = rep(0x04);
const transcriptHash = rep(0x05);
const serverPublic = nacl.box.keyPair.fromSecretKey(serverSecret).publicKey;
const sharedSecret = nacl.box.before(serverPublic, clientSecret);

const hex = (bytes) => Buffer.from(bytes).toString("hex");

test("node:crypto hkdfSync and pure-JS HKDF-SHA256 agree byte-for-byte", () => {
	const pure = deriveSessionKeys(sharedSecret, clientNonce, serverNonce, transcriptHash);
	const node = deriveSessionKeysNode(sharedSecret, clientNonce, serverNonce, transcriptHash);
	assert.equal(hex(pure.mobileToServerKey), hex(node.mobileToServerKey));
	assert.equal(hex(pure.serverToMobileKey), hex(node.serverToMobileKey));
	assert.equal(hex(pure.sessionId), hex(node.sessionId));
});

test("key schedule matches the frozen vector (exact hex)", () => {
	const keys = deriveSessionKeys(sharedSecret, clientNonce, serverNonce, transcriptHash);
	assert.equal(hex(keys.mobileToServerKey), "27bfefcaa256c63f2b0d5d5466b9cfb335a21b6bb47a663ca95f0e52e100b079");
	assert.equal(hex(keys.serverToMobileKey), "896d8ce46b4f67b7e7b8502744becb13c2950bb84d29ac221c804d88652705f2");
	assert.equal(hex(keys.sessionId), "cf3a74ec849e98b664e3912a2d96ef212e75b566ac7bd8cbe1f0919cab7b9722");
});
