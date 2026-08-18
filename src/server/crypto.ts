/**
 * Server-side cryptography: node:crypto HKDF-SHA256 and random bytes, plus the
 * X25519 keypair via tweetnacl. This module is the `node:crypto hkdfSync`
 * counterpart to the mobile page's pure-JS `shared/hkdf.ts`; the cross-end
 * test pins both to the same vector.
 */

import { createHash, hkdfSync, randomBytes as nodeRandomBytes, timingSafeEqual } from "node:crypto";
import nacl from "tweetnacl";
import { KEY_LENGTH } from "../shared/constants.js";
import { computeInfo, computeSalt, type SessionKeys } from "../shared/hkdf.js";

/** Cryptographically secure random bytes. */
export function randomBytes(length: number): Uint8Array {
	return new Uint8Array(nodeRandomBytes(length));
}

/** Generate the server's long-lived X25519 identity keypair. */
export function generateServerKeyPair(): { readonly secretKey: Uint8Array; readonly publicKey: Uint8Array } {
	const keyPair = nacl.box.keyPair();
	return { secretKey: keyPair.secretKey, publicKey: keyPair.publicKey };
}

/** SHA-256 hex (used for device token hashes). */
export function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** Constant-time comparison of two SHA-256 hex digests. */
export function constantTimeEqualHex(a: string, b: string): boolean {
	const aBuffer = Buffer.from(a, "hex");
	const bBuffer = Buffer.from(b, "hex");
	if (aBuffer.length !== bBuffer.length) return false;
	return timingSafeEqual(aBuffer, bBuffer);
}

/** RFC 5869 HKDF-SHA256 via `node:crypto`. */
export function hkdfSyncNode(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array {
	return new Uint8Array(hkdfSync("sha256", ikm, salt, info, length));
}

/** Derive the 96-byte key schedule with `node:crypto` (mirrors `shared/hkdf.ts`). */
export function deriveSessionKeysNode(
	sharedSecret: Uint8Array,
	clientNonce: Uint8Array,
	serverNonce: Uint8Array,
	transcriptHash: Uint8Array,
): SessionKeys {
	const okm = hkdfSyncNode(
		sharedSecret,
		computeSalt(clientNonce, serverNonce),
		computeInfo(transcriptHash),
		KEY_LENGTH * 3,
	);
	return {
		mobileToServerKey: okm.slice(0, KEY_LENGTH),
		serverToMobileKey: okm.slice(KEY_LENGTH, KEY_LENGTH * 2),
		sessionId: okm.slice(KEY_LENGTH * 2, KEY_LENGTH * 3),
	};
}
