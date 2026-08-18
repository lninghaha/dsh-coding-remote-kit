import assert from "node:assert/strict";
import test from "node:test";
import { base64UrlEncode } from "../lib/shared/base64.js";
import {
	MAX_DEVICE_TOKEN_CHARS,
	MAX_ENDPOINT_BYTES,
	MAX_OFFER_CODE_BYTES,
	MAX_PUBLIC_KEY_B64,
} from "../lib/shared/constants.js";
import { decodeOffer, encodeOffer, offerQrText } from "../lib/shared/offer.js";

function makeOffer(overrides = {}) {
	return {
		v: 1,
		endpoint: "ws://192.168.1.5:6879/m/ws",
		pageUrl: "http://192.168.1.5:6879/m",
		deviceToken: "dGhpcy1pcy1hLXRlc3QtZGV2aWNlLXRva2VuLTEyMzQ1Ng",
		publicKeyB64: "aGVsbG8td29ybGQtaGVsbG8td29ybGQtaGVsbG8td29ybGQK",
		offerId: "dGhpcy1pcy1hbi1vZmZlcg",
		expiresAt: 1700000000000,
		...overrides,
	};
}

test("offer codec round-trips through unpadded base64url JSON", () => {
	const offer = makeOffer();
	const code = encodeOffer(offer);
	assert.equal(code.includes("="), false, "offer code must be unpadded");
	assert.equal(code.includes("+"), false);
	assert.equal(code.includes("/"), false);
	assert.deepEqual(decodeOffer(code), offer);
});

test("base64url is unpadded and uses the URL alphabet", () => {
	const encoded = base64UrlEncode(new Uint8Array(32).fill(0xab));
	assert.equal(encoded.includes("="), false);
	assert.equal(encoded.includes("+"), false);
	assert.equal(encoded.includes("/"), false);
	assert.match(encoded, /^[A-Za-z0-9_-]+$/);
});

test("offer field limits are enforced", () => {
	assert.throws(() => decodeOffer(encodeOffer(makeOffer({ endpoint: "w".repeat(MAX_ENDPOINT_BYTES + 1) }))));
	assert.throws(() => decodeOffer(encodeOffer(makeOffer({ deviceToken: "a".repeat(MAX_DEVICE_TOKEN_CHARS + 1) }))));
	assert.throws(() => decodeOffer(encodeOffer(makeOffer({ publicKeyB64: "b".repeat(MAX_PUBLIC_KEY_B64 + 1) }))));
});

test("oversized offer code is rejected", () => {
	const offer = makeOffer();
	// A valid offer is far below the cap; assert the cap itself is wired by
	// pushing the endpoint to its maximum and checking the code stays sane.
	const code = encodeOffer(offer);
	assert.ok(code.length < MAX_OFFER_CODE_BYTES);
	// Explicitly reject a code larger than the cap.
	assert.throws(() => decodeOffer("A".repeat(MAX_OFFER_CODE_BYTES + 1)));
});

test("qr text is pageUrl + '#' + code (fragment-only)", () => {
	const offer = makeOffer();
	const code = encodeOffer(offer);
	const text = offerQrText(offer.pageUrl, code);
	assert.equal(text, `${offer.pageUrl}#${code}`);
	assert.equal(text.split("#")[0], offer.pageUrl);
});

test("decode rejects malformed / wrong-version / unknown-key offers", () => {
	assert.throws(() => decodeOffer("not-base64!!!"));
	assert.throws(() => decodeOffer(encodeOffer({ ...makeOffer(), v: 2 })));
	assert.throws(() => decodeOffer(encodeOffer({ ...makeOffer(), extra: "nope" })));
});
