#!/usr/bin/env node
/**
 * Inspect or locally pack a release artifact.
 *
 * Never changes versions, commits, tags, pushes, publishes, or restarts DSH Web.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "output");
const known = new Set(["--dry-run", "--pack", "--help"]);
const args = new Set(process.argv.slice(2));

for (const flag of args) {
	if (!known.has(flag)) {
		console.error(`Unknown option: ${flag}`);
		process.exit(2);
	}
}
if (args.has("--dry-run") && args.has("--pack")) {
	console.error("Choose either --dry-run or --pack, not both.");
	process.exit(2);
}
if (args.has("--help")) {
	console.log(`dsh-coding-remote-kit release helper

Usage:
  pnpm run release:inspect   Verify metadata + npm pack dry-run
  pnpm run release:pack      Rebuild, verify, and write a local tarball to output/

Neither mode bumps versions, touches Git, or publishes.`);
	process.exit(0);
}

const mode = args.has("--pack") ? "pack" : "dry-run";
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
const constants = readFileSync(join(root, "src/shared/constants.ts"), "utf8");
const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

function fail(message) {
	throw new Error(message);
}

function run(command, commandArgs, options = {}) {
	const result = spawnSync(command, commandArgs, {
		cwd: root,
		encoding: "utf8",
		stdio: options.capture === true ? ["ignore", "pipe", "pipe"] : "inherit",
		env: process.env,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		const details = options.capture === true ? `${result.stderr ?? ""}${result.stdout ?? ""}`.trim() : "";
		fail(`${command} ${commandArgs.join(" ")} failed${details === "" ? "" : `:\n${details}`}`);
	}
	return result.stdout ?? "";
}

if (manifest.name !== "dsh-coding-remote-kit") fail(`unexpected package name: ${String(manifest.name)}`);
if (typeof manifest.version !== "string" || !semver.test(manifest.version)) {
	fail(`package version is not valid SemVer: ${String(manifest.version)}`);
}
const pluginMatch = constants.match(/export const PLUGIN_VERSION = "([^"]+)"/u);
if (pluginMatch?.[1] !== manifest.version) {
	fail(`PLUGIN_VERSION (${pluginMatch?.[1] ?? "missing"}) must equal package.json version ${manifest.version}`);
}
const releaseVersions = [...changelog.matchAll(/^## v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s/gmu)].map((m) => m[1]);
if (releaseVersions[0] !== manifest.version) {
	fail(`latest CHANGELOG release (${releaseVersions[0] ?? "missing"}) does not match ${manifest.version}`);
}
for (const entry of manifest.files ?? []) {
	if (String(entry).includes("docs/local") || String(entry) === "src" || String(entry).startsWith("src/")) {
		fail(`package files must not include ${entry}`);
	}
}

run(process.execPath, [join(root, "scripts/assert-node.mjs")]);
if (mode === "pack") run("pnpm", ["run", "build"]);
else run("pnpm", ["run", "check:bom"]);

const dry = run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { capture: true });
let report;
try {
	report = JSON.parse(dry);
} catch (error) {
	fail(`npm pack --dry-run returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
}
const packed = Array.isArray(report) ? report[0] : report;
const packedFiles = (packed?.files ?? []).map((entry) => entry.path);
const leaked = packedFiles.filter(
	(path) => path.includes("docs/local") || path === "src" || path.startsWith("src/") || path.includes(".env"),
);
if (leaked.length > 0) fail(`packed release contains forbidden files:\n${leaked.join("\n")}`);
console.log(`Verified ${manifest.name}@${manifest.version} (${packedFiles.length} files)`);

if (mode === "dry-run") {
	console.log("Dry-run complete. No version, Git, registry, or tarball changes were made.");
	process.exit(0);
}

mkdirSync(outDir, { recursive: true });
const staging = join(outDir, `.pack-${process.pid}`);
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
const packJson = run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", staging], { capture: true });
const packedReport = JSON.parse(packJson);
const tarballName = Array.isArray(packedReport) ? packedReport[0]?.filename : packedReport?.filename;
if (typeof tarballName !== "string" || tarballName.length === 0) fail("npm pack did not report a filename");
const destination = join(outDir, tarballName);
renameSync(join(staging, tarballName), destination);
rmSync(staging, { recursive: true, force: true });
console.log(`Wrote ${destination}`);
console.log("Copy this tarball out of the repository before `dsh plugin add` (pnpm 11 file:.tgz → link:).");
