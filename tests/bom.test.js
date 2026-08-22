import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("DSH compatibility manifest declares the exact verified BOM and only unverified candidates", async () => {
	const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
	const bom = JSON.parse(await readFile(new URL("../compatibility/dsh-bom.json", import.meta.url), "utf8"));
	assert.equal(bom.verified.id, "dsh-0.1.0-rc.6");
	assert.equal(pkg.dsh.compatibility.verifiedBom, bom.verified.id);
	assert.deepEqual(pkg.dsh.compatibility.bom, bom.verified.packages);
	assert.ok(bom.candidates.every((candidate) => candidate.status === "unverified"));
	for (const version of Object.values(bom.verified.packages)) assert.equal(String(version).includes("*"), false);
});
