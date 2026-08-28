import assert from "node:assert/strict";
import test from "node:test";
import {
	DISCLAIMER_VERSION,
	buildConnectionDiagnostics,
	requireDisclaimerAccepted,
} from "../lib/server/routes.js";

function fakeDeps(overrides = {}) {
	return {
		listening: () => true,
		currentBind: () => "127.0.0.1",
		port: () => 6879,
		registry: {
			devices: [],
			activeDeviceCount: () => 0,
			networkReach: "loopback",
		},
		offers: { count: () => 0 },
		tunnel: {
			snapshot: () => ({
				running: true,
				kind: "cloudflare-quick",
				url: "https://happy-photo-7qx.trycloudflare.com",
				binaryOk: true,
			}),
		},
		...overrides,
	};
}

test("requireDisclaimerAccepted is true only for explicit true", () => {
	assert.equal(requireDisclaimerAccepted(null), false);
	assert.equal(requireDisclaimerAccepted({}), false);
	assert.equal(requireDisclaimerAccepted({ disclaimerAccepted: false }), false);
	assert.equal(requireDisclaimerAccepted({ disclaimerAccepted: "true" }), false);
	assert.equal(requireDisclaimerAccepted({ disclaimerAccepted: true }), true);
});

test("buildConnectionDiagnostics exposes schemaVersion, urlHost, and disclaimer", () => {
	const diag = buildConnectionDiagnostics(fakeDeps());
	assert.equal(diag.schemaVersion, 1);
	assert.equal(diag.disclaimer.requiredVersion, DISCLAIMER_VERSION);
	assert.equal(diag.tunnel.running, true);
	assert.equal(diag.tunnel.urlHost, "happy-photo-7qx.trycloudflare.com");
	assert.equal("url" in diag.tunnel, false);
	assert.ok(typeof diag.cloudflared.pinnedRelease === "string");
	assert.ok(diag.cloudflared.verify === "ok" || typeof diag.cloudflared.verify === "string");
});

test("buildConnectionDiagnostics marks bare CLOUDFLARED env as not-pinned", () => {
	const prev = process.env.CLOUDFLARED;
	process.env.CLOUDFLARED = "cloudflared";
	try {
		const diag = buildConnectionDiagnostics(fakeDeps());
		assert.equal(diag.cloudflared.verify, "not-pinned");
		assert.equal(diag.cloudflared.resolvedPath, null);
	} finally {
		if (prev === undefined) delete process.env.CLOUDFLARED;
		else process.env.CLOUDFLARED = prev;
	}
});
