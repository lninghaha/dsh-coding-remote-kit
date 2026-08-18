import assert from "node:assert/strict";
import test from "node:test";
import { evaluateVersionGate, isDesktopTooOld, isMobileTooOld } from "../lib/shared/version.js";

test("mobile-too-old when mobile protocol is below the desktop floor", () => {
	assert.equal(isMobileTooOld(0, 1), true);
	assert.equal(isMobileTooOld(1, 1), false);
	assert.equal(
		evaluateVersionGate(0, { protocolVersion: 1, minCompatibleMobileVersion: 1 }),
		"mobile-too-old",
	);
});

test("desktop-too-old when desktop protocol is below the mobile floor", () => {
	assert.equal(isDesktopTooOld(0), true);
	assert.equal(isDesktopTooOld(1), false);
	assert.equal(
		evaluateVersionGate(1, { protocolVersion: 0, minCompatibleMobileVersion: 1 }),
		"desktop-too-old",
	);
});

test("fail-open when status.get fails (null status)", () => {
	assert.equal(evaluateVersionGate(1, null), "ok");
});

test("ok when both directions are compatible", () => {
	assert.equal(evaluateVersionGate(1, { protocolVersion: 1, minCompatibleMobileVersion: 1 }), "ok");
});
