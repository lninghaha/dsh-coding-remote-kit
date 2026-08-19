import assert from "node:assert/strict";
import test from "node:test";
import { validateOffer } from "../lib/shared/offer.js";
import {
	assertHttpsRelayOrigin,
	relayAdvertise,
	relayResumeEndpoint,
	wsOriginFromHttp,
} from "../lib/shared/relay.js";

test("relayAdvertise uses https page and wss endpoint without LAN IPs", () => {
	const advertised = relayAdvertise("https://example.com/", "host-1", "invite-token");
	assert.equal(advertised.pageUrl, "https://example.com/m/");
	assert.equal(advertised.endpoint, "wss://example.com/v1/phone/host-1?invite=invite-token");
	assert.deepEqual(advertised.candidates, ["example.com"]);
	const offer = validateOffer({
		v: 1,
		endpoint: advertised.endpoint,
		pageUrl: advertised.pageUrl,
		deviceToken: "d".repeat(32),
		publicKeyB64: "A".repeat(44),
		offerId: "offer-1",
		expiresAt: Date.now() + 1_000,
	});
	assert.equal(offer.v, 1);
});

test("assertHttpsRelayOrigin rejects http and credentials", () => {
	assert.equal(assertHttpsRelayOrigin("https://example.com/path"), "https://example.com");
	assert.throws(() => assertHttpsRelayOrigin("http://example.com"));
	assert.throws(() => assertHttpsRelayOrigin("https://user:pass@example.com"));
	assert.equal(wsOriginFromHttp("https://example.com"), "wss://example.com");
	assert.equal(relayResumeEndpoint("https://example.com", "host-1"), "wss://example.com/v1/phone/host-1?resume=1");
});
