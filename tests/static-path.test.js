import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cacheControlForMobile, resolveMobileStaticPath } from "../lib/server/dataplane.js";

test("trailing slash on mobileDir still serves index.html (not 403)", () => {
	const dir = mkdtempSync(join(tmpdir(), "dshmr-static-"));
	writeFileSync(join(dir, "index.html"), "<html></html>");
	const withSlash = `${dir}/`;
	const resolved = resolveMobileStaticPath(withSlash, "index.html");
	assert.equal(resolved, join(dir, "index.html"));
	assert.equal(resolveMobileStaticPath(dir, "index.html"), join(dir, "index.html"));
});

test("path traversal is still rejected", () => {
	const dir = mkdtempSync(join(tmpdir(), "dshmr-static-"));
	assert.equal(resolveMobileStaticPath(dir, "../secret"), null);
	assert.equal(resolveMobileStaticPath(`${dir}/`, "../secret"), null);
});

test("PWA shell assets may be cached; HTML and SW must not", () => {
	assert.equal(cacheControlForMobile("index.html"), "no-store");
	assert.equal(cacheControlForMobile("sw.js"), "no-store");
	assert.equal(cacheControlForMobile("app.js"), "public, max-age=300");
	assert.equal(cacheControlForMobile("manifest.webmanifest"), "public, max-age=86400");
	assert.equal(cacheControlForMobile("icons/icon-192.png"), "public, max-age=86400");
});
