/**
 * Self-contained base64 codecs shared by server and mobile.
 *
 * - "canonical base64" (the 32-byte keys / nonces / transcriptHash on the wire)
 *   is standard RFC 4648 base64 *with* padding.
 * - "base64url" (deviceToken / offerId / the pairing offer code) is RFC 4648
 *   §5 with `+`→`-`, `/`→`_`, and no padding.
 *
 * Implemented on a lookup table so it behaves identically in node (no Buffer)
 * and in the browser (no `btoa`/`atob` dependency).
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function encode(bytes: Uint8Array, alphabet: string, pad: boolean): string {
	let out = "";
	let i = 0;
	const length = bytes.length;
	while (i + 3 <= length) {
		const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
		out +=
			alphabet.charAt((n >> 18) & 63) +
			alphabet.charAt((n >> 12) & 63) +
			alphabet.charAt((n >> 6) & 63) +
			alphabet.charAt(n & 63);
		i += 3;
	}
	const remaining = length - i;
	if (remaining === 1) {
		const n = bytes[i]! << 16;
		out += alphabet.charAt((n >> 18) & 63) + alphabet.charAt((n >> 12) & 63);
		if (pad) out += "==";
	} else if (remaining === 2) {
		const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
		out +=
			alphabet.charAt((n >> 18) & 63) + alphabet.charAt((n >> 12) & 63) + alphabet.charAt((n >> 6) & 63);
		if (pad) out += "=";
	}
	return out;
}

function decodeChar(value: string, table: Record<string, number>): number {
	const decoded = table[value];
	if (decoded === undefined) throw new Error("invalid base64 input");
	return decoded;
}

function buildTable(alphabet: string): Record<string, number> {
	const table: Record<string, number> = {};
	for (let i = 0; i < alphabet.length; i += 1) table[alphabet[i]!] = i;
	return table;
}

const STD_TABLE = buildTable(ALPHABET);
const URL_TABLE = buildTable(URL_ALPHABET);

function decode(text: string, table: Record<string, number>): Uint8Array {
	if (text.length % 4 !== 0) throw new Error("invalid base64 length");
	let padding = 0;
	if (text.endsWith("==")) padding = 2;
	else if (text.endsWith("=")) padding = 1;
	const significant = text.length - padding;
	if (significant % 4 === 1) throw new Error("invalid base64 length");
	const output = new Uint8Array(Math.floor((significant * 6) / 8));
	let offset = 0;
	let accumulator = 0;
	let bits = 0;
	for (let i = 0; i < significant; i += 1) {
		accumulator = (accumulator << 6) | decodeChar(text[i]!, table);
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			output[offset++] = (accumulator >> bits) & 0xff;
		}
	}
	return output;
}

/** Canonical (padded) base64 of arbitrary bytes. */
export function base64Encode(bytes: Uint8Array): string {
	return encode(bytes, ALPHABET, true);
}

/** Decode canonical base64 (padded; rejects malformed input). */
export function base64Decode(text: string): Uint8Array {
	return decode(text, STD_TABLE);
}

/** base64url (unpadded) of arbitrary bytes. */
export function base64UrlEncode(bytes: Uint8Array): string {
	return encode(bytes, URL_ALPHABET, false);
}

/** Decode base64url (unpadded on the wire; padded internally for decoding). */
export function base64UrlDecode(text: string): Uint8Array {
	const padding = (4 - (text.length % 4)) % 4;
	return decode(text + "=".repeat(padding), URL_TABLE);
}

/** UTF-8 encode a string to bytes (lossy-free for the protocol's ASCII fields). */
export function utf8Encode(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

/** UTF-8 decode bytes to a string. */
export function utf8Decode(bytes: Uint8Array): string {
	return new TextDecoder("utf-8").decode(bytes);
}
