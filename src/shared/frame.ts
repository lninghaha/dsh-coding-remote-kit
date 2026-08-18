/**
 * Sealed frame layout (dshmr-e2ee v1), shared by server and mobile.
 *
 *   sealed = nonce(24) ‖ secretbox( header(42) ‖ payload )
 *   header = sessionId(32) ‖ direction(1) ‖ payloadKind(1) ‖ counter_be64(8)
 *   nonce  = sessionId[0:12] ‖ version=1(1) ‖ direction(1) ‖ payloadKind(1) ‖ 0(1) ‖ counter_be64(8)
 *
 * The nonce is deterministic, so the receiver can reject a frame whose nonce
 * disagrees with its expected (direction, kind, counter) before even opening
 * the box. Any disagreement — wrong counter, wrong direction, wrong kind, or a
 * failed open — yields `null`.
 */

import nacl from "tweetnacl";
import { DIRECTION_SERVER_TO_MOBILE, E2EE_VERSION, HEADER_LENGTH, NONCE_LENGTH, SESSION_ID_LENGTH } from "./constants.js";
import { constantTimeEqual } from "./validation.js";

function writeUint64BE(value: number): Uint8Array {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error("counter must be a non-negative safe integer");
	const big = BigInt(value);
	const out = new Uint8Array(8);
	for (let i = 0; i < 8; i += 1) out[7 - i] = Number((big >> BigInt(i * 8)) & 0xffn);
	return out;
}

function readUint64BE(bytes: Uint8Array, offset: number): number {
	let value = 0n;
	for (let i = 0; i < 8; i += 1) value = (value << 8n) | BigInt(bytes[offset + i]!);
	return Number(value);
}

/** Build the deterministic 24-byte nonce for a (direction, kind, counter) triple. */
export function buildNonce(sessionId: Uint8Array, direction: number, kind: number, counter: number): Uint8Array {
	const nonce = new Uint8Array(NONCE_LENGTH);
	nonce.set(sessionId.slice(0, 12), 0);
	nonce[12] = E2EE_VERSION;
	nonce[13] = direction;
	nonce[14] = kind;
	nonce[15] = 0;
	nonce.set(writeUint64BE(counter), 16);
	return nonce;
}

/** Build the 42-byte header for a (direction, kind, counter) triple. */
export function buildHeader(sessionId: Uint8Array, direction: number, kind: number, counter: number): Uint8Array {
	const header = new Uint8Array(HEADER_LENGTH);
	header.set(sessionId, 0);
	header[SESSION_ID_LENGTH] = direction;
	header[SESSION_ID_LENGTH + 1] = kind;
	header.set(writeUint64BE(counter), SESSION_ID_LENGTH + 2);
	return header;
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

/**
 * Seal a payload for transport. `key` is the sender's per-direction 32-byte
 * secretbox key.
 */
export function seal(
	key: Uint8Array,
	sessionId: Uint8Array,
	direction: number,
	kind: number,
	counter: number,
	payload: Uint8Array,
): Uint8Array {
	const nonce = buildNonce(sessionId, direction, kind, counter);
	const header = buildHeader(sessionId, direction, kind, counter);
	const box = nacl.secretbox(concat([header, payload]), nonce, key);
	return concat([nonce, box]);
}

/**
 * Open a sealed frame, returning the payload or `null` when the frame does not
 * match the expected (sessionId, direction, kind, counter) or fails MAC.
 */
export function open(
	sealed: Uint8Array,
	key: Uint8Array,
	sessionId: Uint8Array,
	direction: number,
	kind: number,
	counter: number,
): Uint8Array | null {
	if (sealed.length < NONCE_LENGTH + nacl.secretbox.overheadLength) return null;
	const nonce = sealed.slice(0, NONCE_LENGTH);
	const box = sealed.slice(NONCE_LENGTH);
	const expectedNonce = buildNonce(sessionId, direction, kind, counter);
	if (!constantTimeEqual(nonce, expectedNonce)) return null;
	const plaintext = nacl.secretbox.open(box, nonce, key);
	if (plaintext === null) return null;
	if (plaintext.length < HEADER_LENGTH) return null;
	const headerDirection = plaintext[SESSION_ID_LENGTH]!;
	const headerKind = plaintext[SESSION_ID_LENGTH + 1]!;
	const headerCounter = readUint64BE(plaintext, SESSION_ID_LENGTH + 2);
	if (headerDirection !== direction || headerKind !== kind || headerCounter !== counter) return null;
	if (!constantTimeEqual(plaintext.slice(0, SESSION_ID_LENGTH), sessionId)) return null;
	return plaintext.slice(HEADER_LENGTH);
}

/** Validate a direction byte (0 mobile→server, 1 server→mobile). */
export function isValidDirection(direction: number): boolean {
	return direction === 0 || direction === DIRECTION_SERVER_TO_MOBILE;
}
