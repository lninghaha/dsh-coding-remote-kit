import assert from "node:assert/strict";
import test from "node:test";
import {
	classifyNetworkAddress,
	sanitizedNetworkCandidates,
} from "../lib/server/net.js";

test("classifyNetworkAddress maps Tailscale CGNAT and RFC1918", () => {
	assert.equal(classifyNetworkAddress("100.64.1.2"), "tailscale");
	assert.equal(classifyNetworkAddress("100.127.0.1"), "tailscale");
	assert.equal(classifyNetworkAddress("10.0.0.5"), "rfc1918");
	assert.equal(classifyNetworkAddress("172.16.0.1"), "rfc1918");
	assert.equal(classifyNetworkAddress("192.168.1.10"), "rfc1918");
	assert.equal(classifyNetworkAddress("8.8.8.8"), "other");
	assert.equal(classifyNetworkAddress("not-an-ip"), "other");
});

test("sanitizedNetworkCandidates is address + kind only (no iface metadata)", () => {
	const rows = sanitizedNetworkCandidates(["100.64.1.2", "192.168.1.10", "1.1.1.1"]);
	assert.deepEqual(rows, [
		{ address: "100.64.1.2", kind: "tailscale" },
		{ address: "192.168.1.10", kind: "rfc1918" },
		{ address: "1.1.1.1", kind: "other" },
	]);
	for (const row of rows) {
		assert.deepEqual(Object.keys(row).sort(), ["address", "kind"]);
	}
});
