import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("package identity matches the M1 contract", async () => {
	const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
	assert.equal(pkg.name, "dsh-mobile-remote");
	assert.equal(pkg.version, "0.0.0");
	assert.equal(pkg.exports["."], "./lib/server/index.js");
	assert.equal(pkg.exports["./client"], "./lib/client.js");
	assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
	assert.equal(pkg.dsh.client.platform, "web");
});
