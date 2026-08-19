import assert from "node:assert/strict";
import test from "node:test";
import { formatPairCode, isCompletePairCode, normalizePairCode, pairCodeFromBytes } from "../lib/shared/pair-code.js";

test("normalize maps lookalikes and strips separators", () => {
	assert.equal(normalizePairCode("ab-ol"), "AB01");
	assert.equal(normalizePairCode("7k3m 9q2p"), "7K3M9Q2P");
	assert.equal(isCompletePairCode("7K3M-9Q2P"), true);
	assert.equal(isCompletePairCode("7K3M"), false);
});

test("formatPairCode inserts a dash", () => {
	assert.equal(formatPairCode("7K3M9Q2P"), "7K3M-9Q2P");
});

test("pairCodeFromBytes is 8 alphabet chars", () => {
	const code = pairCodeFromBytes(new Uint8Array(8).fill(1));
	assert.equal(code.length, 8);
	assert.match(code, /^[0-9A-HJKMNP-TV-Z]+$/);
});
