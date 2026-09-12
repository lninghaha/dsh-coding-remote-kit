import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DSH_VERSION, PLUGIN_VERSION } from "../lib/shared/constants.js";

test("DSH compatibility manifest declares the exact verified BOM and statused candidates", async () => {
	const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
	const bom = JSON.parse(await readFile(new URL("../compatibility/dsh-bom.json", import.meta.url), "utf8"));
	assert.equal(bom.verified.id, "dsh-0.1.1-rc.2");
	assert.equal(bom.verified.dshVersion, "0.1.1-rc.2");
	assert.equal(pkg.dsh.compatibility.verifiedBom, bom.verified.id);
	assert.deepEqual(pkg.dsh.compatibility.bom, bom.verified.packages);
	assert.equal(DSH_VERSION, bom.verified.dshVersion);
	assert.equal(PLUGIN_VERSION, pkg.version);
	for (const candidate of bom.candidates) {
		assert.ok(["verified", "unverified"].includes(candidate.status), `unexpected status ${candidate.status}`);
	}
	assert.ok(bom.candidates.some((candidate) => candidate.id === "dsh-0.1.2-alpha.4"));
	const runtimeVerified = bom.candidates.find((candidate) => candidate.id === "dsh-0.1.5-rc.2");
	assert.equal(runtimeVerified?.status, "verified");
	assert.equal(runtimeVerified?.sessionBackend, "sessionController");
	for (const version of Object.values(bom.verified.packages)) assert.equal(String(version).includes("*"), false);
});
