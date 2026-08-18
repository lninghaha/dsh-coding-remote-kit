/**
 * Pairing offer (v1) codec. The offer JSON is encoded as unpadded base64url and
 * rides only in the URL fragment (`pageUrl + '#' + code`) so it never reaches
 * the network path or server logs.
 */

import {
	MAX_DEVICE_TOKEN_CHARS,
	MAX_ENDPOINT_BYTES,
	MAX_OFFER_CODE_BYTES,
	MAX_PUBLIC_KEY_B64,
} from "./constants.js";
import { base64UrlDecode, base64UrlEncode, utf8Decode, utf8Encode } from "./base64.js";
import { assertExactKeys, assertInteger, assertString, ProtocolValidationError } from "./validation.js";

export interface PairingOffer {
	readonly v: 1;
	readonly endpoint: string;
	readonly pageUrl: string;
	readonly deviceToken: string;
	readonly publicKeyB64: string;
	readonly offerId: string;
	readonly expiresAt: number;
}

export const OFFER_KEYS = ["v", "endpoint", "pageUrl", "deviceToken", "publicKeyB64", "offerId", "expiresAt"] as const;

/** Validate offer field values against the frozen size limits. */
export function validateOffer(value: unknown): PairingOffer {
	assertExactKeys(value, OFFER_KEYS);
	assertInteger(value.v, "v");
	if (value.v !== 1) throw new ProtocolValidationError("offer v must be 1");
	assertString(value.endpoint, "endpoint");
	assertString(value.pageUrl, "pageUrl");
	assertString(value.deviceToken, "deviceToken");
	assertString(value.publicKeyB64, "publicKeyB64");
	assertString(value.offerId, "offerId");
	assertInteger(value.expiresAt, "expiresAt");
	if (utf8Encode(value.endpoint).length > MAX_ENDPOINT_BYTES) {
		throw new ProtocolValidationError("endpoint exceeds 2KiB");
	}
	if (value.deviceToken.length > MAX_DEVICE_TOKEN_CHARS) {
		throw new ProtocolValidationError("deviceToken exceeds 128 characters");
	}
	if (value.publicKeyB64.length > MAX_PUBLIC_KEY_B64) {
		throw new ProtocolValidationError("publicKeyB64 exceeds 64 characters");
	}
	return {
		v: 1,
		endpoint: value.endpoint,
		pageUrl: value.pageUrl,
		deviceToken: value.deviceToken,
		publicKeyB64: value.publicKeyB64,
		offerId: value.offerId,
		expiresAt: value.expiresAt,
	};
}

/** Encode an offer to the pairing-code string (unpadded base64url of JSON). */
export function encodeOffer(offer: PairingOffer): string {
	return base64UrlEncode(utf8Encode(JSON.stringify(offer)));
}

/** Decode a pairing-code string, validating structure and size limits. */
export function decodeOffer(code: string): PairingOffer {
	if (code.length === 0) throw new ProtocolValidationError("offer code is empty");
	if (utf8Encode(code).length > MAX_OFFER_CODE_BYTES) {
		throw new ProtocolValidationError("offer code exceeds 16KiB");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(utf8Decode(base64UrlDecode(code)));
	} catch {
		throw new ProtocolValidationError("offer code is not valid base64url JSON");
	}
	return validateOffer(parsed);
}

/** QR text: the page URL plus the offer code as the URL fragment. */
export function offerQrText(pageUrl: string, code: string): string {
	return `${pageUrl}#${code}`;
}
