import assert from "node:assert/strict";
import test from "node:test";
import { loadPersistedOffer, persistOffer } from "../lib/mobile/persist.js";

function memoryStorage() {
	const map = new Map();
	return {
		getItem(key) {
			return map.has(key) ? map.get(key) : null;
		},
		setItem(key, value) {
			map.set(key, value);
		},
	};
}

test("persisted offer round-trips and rejects garbage", () => {
	const storage = memoryStorage();
	const offer = {
		v: 1,
		endpoint: "wss://example.com/v1/phone/h?invite=i",
		pageUrl: "https://example.com/m/",
		deviceToken: "d".repeat(32),
		publicKeyB64: "A".repeat(44),
		offerId: "offer-1",
		expiresAt: 1_700_000_000_000,
	};
	persistOffer(storage, offer);
	assert.deepEqual(loadPersistedOffer(storage), offer);
	storage.setItem("dshmr.offer", "{not-json");
	assert.equal(loadPersistedOffer(storage), null);
});
