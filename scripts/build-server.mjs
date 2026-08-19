import { mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { assertServerBundle } from "./assert-server-bundle.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverOut = resolve(root, "lib/server");

await mkdir(serverOut, { recursive: true });

// 1. Bundled, self-contained plugin entry (what ships and what DSH loads).
await build({
	entryPoints: [resolve(root, "src/server/index.ts")],
	outfile: resolve(serverOut, "index.js"),
	bundle: true,
	format: "esm",
	platform: "node",
	target: "es2022",
	sourcemap: "external",
	sourcesContent: true,
	legalComments: "none",
	// Never pack node_modules into this ESM entry. tweetnacl 1.x does a
	// conditional `require("crypto")`; esbuild's CJS-in-ESM stub throws
	// "Dynamic require of crypto is not supported" and DSH's plugin tree
	// fail-fasts the whole `dsh web` process. Leaving packages external lets
	// Node load tweetnacl as CJS so its own require works. `ws` is the same
	// class of problem (optional native addons).
	packages: "external",
});

const bundled = await readFile(resolve(serverOut, "index.js"), "utf8");
assertServerBundle(bundled, resolve(serverOut, "index.js"));

// 2. Transpile the source tree (shared + server internals + mobile/e2ee) into
// lib/ so the unit tests can import the built artifacts directly. The three
// entry points with their own dedicated bundles are excluded.
const excluded = new Set([
	resolve(root, "src/server/index.ts"),
	resolve(root, "src/client/index.ts"),
	resolve(root, "src/mobile/main.ts"),
]);

async function collectTs(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const full = resolve(dir, entry.name);
		if (entry.isDirectory()) files.push(...(await collectTs(full)));
		else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) files.push(full);
	}
	return files;
}

const entryPoints = (await collectTs(resolve(root, "src"))).filter((file) => !excluded.has(file));

await build({
	entryPoints,
	outdir: resolve(root, "lib"),
	outbase: resolve(root, "src"),
	bundle: false,
	format: "esm",
	platform: "node",
	target: "es2022",
	sourcemap: "external",
	sourcesContent: true,
	legalComments: "none",
});

console.log(`built ${resolve(serverOut, "index.js")} (+ transpiled test surface)`);
