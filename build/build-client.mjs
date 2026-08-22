import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readDshClientPlatformContract } from "./dsh-client-platform.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = resolve(root, "lib/client.js");
const platform = await readDshClientPlatformContract();

await mkdir(resolve(root, "lib"), { recursive: true });

await build({
	entryPoints: [resolve(root, "src/client/index.ts")],
	outfile,
	bundle: true,
	format: "cjs",
	platform: "browser",
	target: "es2022",
	external: [...platform.modules],
	sourcemap: "external",
	sourcesContent: true,
	legalComments: "none",
	minify: true,
	define: {
		"process.env.NODE_ENV": JSON.stringify("production"),
	},
	banner: {
		js: 'window.__ModuleLoader__.load({id:"dsh-coding-remote-kit",factory:(require)=>{var module={exports:{}};var exports=module.exports;',
	},
	footer: {
		js: "return module.exports;}});",
	},
});

console.log(`built ${outfile} against dsh-client-web ${platform.version}`);
