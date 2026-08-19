import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertServerBundle } from "../build/assert-server-bundle.mjs";

test("server ESM entry keeps CJS packages external", async () => {
	const source = await readFile(new URL("../lib/server/index.js", import.meta.url), "utf8");
	assert.doesNotThrow(() => assertServerBundle(source));
});
