/**
 * Pure-JS HKDF-SHA256 (RFC 5869) built on js-sha256's HMAC.
 *
 * This is the mobile-side implementation. The server uses `node:crypto`
 * `hkdfSync`; the cross-end test pins both to the same vector.
 */

import { sha256 } from "js-sha256";
import { INFO_LABEL, KEY_LENGTH, SALT_LABEL } from "./constants.js";

/** SHA-256 over arbitrary bytes, returned as bytes. */
export function sha256Bytes(message: Uint8Array): Uint8Array {
	return Uint8Array.from(sha256.array(message));
}

/** SHA-256 over arbitrary bytes, returned as lowercase hex. */
export function sha256Hex(message: Uint8Array): string {
	return sha256.hex(message);
}

/** HMAC-SHA256 (bytes in, bytes out). */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
	return Uint8Array.from(sha256.hmac.array(key, message));
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const output = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		output.set(part, offset);
		offset += part.length;
	}
	return output;
}

/** RFC 5869 HKDF-SHA256 extract-and-expand. */
export function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array {
	const prk = hmacSha256(salt, ikm); // extract
	const blocks: Uint8Array[] = [];
	let previous: Uint8Array = new Uint8Array(0);
	let remaining = length;
	let counter = 1;
	while (remaining > 0) {
		previous = hmacSha256(prk, concat([previous, info, Uint8Array.of(counter)]));
		const take = Math.min(remaining, previous.length);
		blocks.push(previous.slice(0, take));
		remaining -= take;
		counter += 1;
	}
	const output = concat(blocks);
	return output.slice(0, length);
}

/** Deterministic transcript salt: SHA-256(saltLabel ‖ clientNonce ‖ serverNonce). */
export function computeSalt(clientNonce: Uint8Array, serverNonce: Uint8Array): Uint8Array {
	return sha256Bytes(concat([new TextEncoder().encode(`${SALT_LABEL}\u0000`), clientNonce, serverNonce]));
}

/** HKDF info: infoLabel ‖ transcriptHash. */
export function computeInfo(transcriptHash: Uint8Array): Uint8Array {
	return concat([new TextEncoder().encode(`${INFO_LABEL}\u0000`), transcriptHash]);
}

export interface SessionKeys {
	readonly mobileToServerKey: Uint8Array;
	readonly serverToMobileKey: Uint8Array;
	readonly sessionId: Uint8Array;
}

/**
 * Derive the 96-byte key schedule and split it. This is the shared/mobile
 * pure-JS path; `deriveSessionKeysNode` in server/crypto mirrors it with
 * `node:crypto` and must produce identical bytes.
 */
export function deriveSessionKeys(
	sharedSecret: Uint8Array,
	clientNonce: Uint8Array,
	serverNonce: Uint8Array,
	transcriptHash: Uint8Array,
): SessionKeys {
	const okm = hkdfSha256(sharedSecret, computeSalt(clientNonce, serverNonce), computeInfo(transcriptHash), KEY_LENGTH * 3);
	return {
		mobileToServerKey: okm.slice(0, KEY_LENGTH),
		serverToMobileKey: okm.slice(KEY_LENGTH, KEY_LENGTH * 2),
		sessionId: okm.slice(KEY_LENGTH * 2, KEY_LENGTH * 3),
	};
}
