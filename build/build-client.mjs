import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const PLATFORM_MODULES = Object.freeze([
	"react",
	"react/jsx-runtime",
	"react-dom",
	"react-dom/client",
	"@deepseek-ai/cordis",
	"@deepseek-ai/dsh-client-ui-slots",
	"@deepseek-ai/dsh-client-web-react",
	"@deepseek-ai/dsh-client-ui-primitives",
	"@deepseek-ai/dsh-client-ui-attachment",
	"@deepseek-ai/dsh-client-schema-form",
]);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = resolve(root, "lib/client.js");

await mkdir(resolve(root, "lib"), { recursive: true });

await build({
	entryPoints: [resolve(root, "src/client/index.ts")],
	outfile,
	bundle: true,
	format: "cjs",
	platform: "browser",
	target: "es2022",
	external: [...PLATFORM_MODULES],
	sourcemap: "external",
	sourcesContent: true,
	legalComments: "none",
	minify: true,
	define: {
		"process.env.NODE_ENV": JSON.stringify("production"),
	},
	banner: {
		js: 'window.__ModuleLoader__.load({id:"dsh-mobile-remote",factory:(require)=>{var module={exports:{}};var exports=module.exports;',
	},
	footer: {
		js: "return module.exports;}});",
	},
});

console.log(`built ${outfile}`);
