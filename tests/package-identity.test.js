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
	assert.equal(pkg.version, "0.5.2");
	assert.equal(pkg.exports["."], "./lib/server/index.js");
	assert.equal(pkg.exports["./client"], "./lib/client.js");
	assert.equal(pkg.exports["./package.json"], "./package.json");
	assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
	assert.equal(pkg.dsh.client.platform, "web");
	assert.ok(!(pkg.files ?? []).some((entry) => String(entry).startsWith("relay")));
});

test("mobile service worker cache name is stamped with the package version", async () => {
	const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
	const source = await readFile(new URL("../src/mobile/sw.js", import.meta.url), "utf8");
	const built = await readFile(new URL("../lib/mobile/sw.js", import.meta.url), "utf8");
	assert.match(source, /dshmr-shell-__DSHMR_SHELL_VERSION__/);
	assert.doesNotMatch(source, new RegExp(`dshmr-shell-${pkg.version.replaceAll(".", "\\.")}`));
	assert.match(built, new RegExp(`const CACHE = "dshmr-shell-${pkg.version.replaceAll(".", "\\.")}"`));
	assert.doesNotMatch(built, /__DSHMR_SHELL_VERSION__/);
});
