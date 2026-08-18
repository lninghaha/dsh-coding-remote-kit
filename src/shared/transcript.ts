/**
 * Handshake transcript encoding (dshmr-e2ee v1).
 *
 * Byte layout (frozen; both ends must agree byte-for-byte):
 *
 *   transcript =
 *       utf8(TRANSCRIPT_DOMAIN)                          // raw domain-separation prefix
 *     ‖ for each top-level field IN FIXED ORDER: tlv(value)
 *
 * where `tlv(value) = LE32(len(valueBytes)) ‖ valueBytes` and `valueBytes` is:
 *   - string  → UTF-8 bytes
 *   - number  → UTF-8 of its canonical decimal string
 *   - boolean → UTF-8 "true" / "false"
 *   - array   → concat over elements in order: tlv(element)
 *   - object  → concat over keys in ALPHABETICAL order: tlv(value-of-key)
 *
 * Field names are not themselves encoded: position fixes the field for the
 * top-level message, and alphabetical order fixes it for nested objects. This
 * is the canonical-order guarantee exercised by the determinism tests.
 */

import { TRANSCRIPT_DOMAIN } from "./constants.js";
import { utf8Encode } from "./base64.js";

export type TranscriptScalar = string | number | boolean;
export type TranscriptValue = TranscriptScalar | TranscriptValue[] | { readonly [key: string]: TranscriptValue };
export type TranscriptMessage = { readonly [key: string]: TranscriptValue };

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

/** LE32 length prefix + bytes. */
export function tlv(bytes: Uint8Array): Uint8Array {
	const framed = new Uint8Array(4 + bytes.length);
	framed[0] = bytes.length & 0xff;
	framed[1] = (bytes.length >>> 8) & 0xff;
	framed[2] = (bytes.length >>> 16) & 0xff;
	framed[3] = (bytes.length >>> 24) & 0xff;
	framed.set(bytes, 4);
	return framed;
}

/** Recursive canonical value encoding (see module doc). */
export function encodeTranscriptValue(value: TranscriptValue): Uint8Array {
	if (typeof value === "string") return utf8Encode(value);
	if (typeof value === "number") return utf8Encode(String(value));
	if (typeof value === "boolean") return utf8Encode(value ? "true" : "false");
	if (Array.isArray(value)) return concat(value.map((element) => tlv(encodeTranscriptValue(element))));
	const keys = Object.keys(value).sort();
	return concat(keys.map((key) => tlv(encodeTranscriptValue(value[key]!))));
}

/**
 * Encode one message whose top-level fields appear in the fixed order given by
 * `fieldOrder`. Any key present in `message` but absent from `fieldOrder` is
 * still emitted after the ordered keys (alphabetically), so the encoder never
 * silently drops data — validation rejects extra keys before this runs.
 */
export function encodeTranscriptMessage(
	message: TranscriptMessage,
	fieldOrder: readonly string[],
): Uint8Array {
	const seen = new Set<string>();
	const parts: Uint8Array[] = [];
	for (const key of fieldOrder) {
		if (Object.prototype.hasOwnProperty.call(message, key)) {
			parts.push(tlv(encodeTranscriptValue(message[key]!)));
			seen.add(key);
		}
	}
	const extras = Object.keys(message)
		.filter((key) => !seen.has(key))
		.sort();
	for (const key of extras) {
		parts.push(tlv(encodeTranscriptValue(message[key]!)));
	}
	return concat(parts);
}

/** Full transcript: domain ‖ hello ‖ ready. */
export function buildTranscript(hello: TranscriptMessage, ready: TranscriptMessage): Uint8Array {
	const domain = utf8Encode(TRANSCRIPT_DOMAIN);
	const helloPart = encodeTranscriptMessage(hello, [
		"type",
		"v",
		"clientPublicKeyB64",
		"clientNonceB64",
		"capabilities",
		"context",
	]);
	const readyPart = encodeTranscriptMessage(ready, [
		"type",
		"v",
		"serverPublicKeyB64",
		"clientNonceB64",
		"serverNonceB64",
		"selection",
		"context",
	]);
	return concat([domain, helloPart, readyPart]);
}
