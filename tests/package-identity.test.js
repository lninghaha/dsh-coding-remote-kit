import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("bundled server entry imports under Node ESM (no dynamic-require crash)", async () => {
	const plugin = await import("../lib/server/index.js");
	assert.equal(plugin.name, "mobile-remote");
	assert.equal(typeof plugin.apply, "function");
	assert.equal(typeof plugin.Config, "object");
	assert.ok(Array.isArray(plugin.inject));
});

test("package identity matches the M1 contract", async () => {
	const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
	assert.equal(pkg.name, "dsh-coding-remote-kit");
	assert.equal(pkg.version, "0.4.0");
	assert.equal(pkg.exports["."], "./lib/server/index.js");
	assert.equal(pkg.exports["./client"], "./lib/client.js");
	assert.equal(pkg.exports["./package.json"], "./package.json");
	assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
	assert.equal(pkg.dsh.client.platform, "web");
	assert.ok(!(pkg.files ?? []).some((entry) => String(entry).startsWith("relay")));
});
