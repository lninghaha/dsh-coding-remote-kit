import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = resolve(root, "lib/mobile");

await mkdir(outdir, { recursive: true });

// Bundle the mobile page into a self-contained IIFE (tweetnacl + js-sha256 +
// shared protocol code are all inlined — no external module loader).
await build({
	entryPoints: [resolve(root, "src/mobile/main.ts")],
	outfile: resolve(outdir, "app.js"),
	bundle: true,
	format: "iife",
	platform: "browser",
	target: "es2022",
	sourcemap: "external",
	sourcesContent: true,
	legalComments: "none",
	minify: true,
});

await copyFile(resolve(root, "src/mobile/index.html"), resolve(outdir, "index.html"));

console.log(`built ${resolve(outdir, "app.js")}`);
console.log(`copied ${resolve(outdir, "index.html")}`);
