import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);

/**
 * Read the versioned, official client platform contract lazily as CJS source.
 * Loading the browser entry under Node can execute CSS imports, so an export
 * shape change is a hard compatibility failure instead of a stale fallback.
 */
export async function readDshClientPlatformContract() {
	const manifestPath = require.resolve("@deepseek-ai/dsh-client-web/package.json");
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	const entryPath = resolve(dirname(manifestPath), manifest.main ?? "lib/index.js");
	const source = await readFile(entryPath, "utf8");
	const match = source.match(/const\s+PLATFORM_MODULES\s*=\s*(\[[\s\S]*?\])\s*;/u);
	if (match?.[1] === undefined) {
		throw new Error("@deepseek-ai/dsh-client-web no longer exposes a parseable PLATFORM_MODULES contract");
	}
	const modules = JSON.parse(match[1]);
	if (!Array.isArray(modules) || modules.length === 0 || modules.some((value) => typeof value !== "string")) {
		throw new Error("@deepseek-ai/dsh-client-web PLATFORM_MODULES is not a non-empty string array");
	}
	if (new Set(modules).size !== modules.length) {
		throw new Error("@deepseek-ai/dsh-client-web PLATFORM_MODULES contains duplicate entries");
	}
	return Object.freeze({ version: String(manifest.version), modules: Object.freeze([...modules]) });
}
