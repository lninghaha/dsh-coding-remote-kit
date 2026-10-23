import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
import { readDshClientPlatformContract } from "../build/dsh-client-platform.mjs";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bom = JSON.parse(await readFile(resolve(root, "compatibility/dsh-bom.json"), "utf8"));
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const failures = [];
const satisfyOpts = { includePrerelease: true };

if (pkg.dsh?.compatibility?.coreAbi !== bom.coreAbi) {
	failures.push("package dsh.compatibility.coreAbi does not match the verified BOM");
}
if (pkg.dsh?.compatibility?.verifiedBom !== bom.verified.id) {
	failures.push("package dsh.compatibility.verifiedBom does not match the verified BOM");
}
if (JSON.stringify(pkg.dsh?.compatibility?.bom) !== JSON.stringify(bom.verified.packages)) {
	failures.push("package dsh.compatibility.bom does not match the exact verified BOM");
}

const enginesDsh = pkg.engines?.dsh;
if (typeof enginesDsh !== "string" || enginesDsh.trim() === "") {
	failures.push("package.json engines.dsh is required (host install gate)");
} else if (!semver.satisfies(bom.verified.dshVersion, enginesDsh, satisfyOpts)) {
	failures.push(`engines.dsh ${JSON.stringify(enginesDsh)} must include verified ${bom.verified.dshVersion}`);
}

for (const [name, expected] of Object.entries(bom.verified.packages)) {
	if (pkg.devDependencies?.[name] !== expected) failures.push(`${name}: devDependency is not pinned to ${expected}`);
	const peer = pkg.peerDependencies?.[name];
	if (peer !== undefined) {
		if (typeof peer !== "string" || !semver.satisfies(expected, peer, satisfyOpts)) {
			failures.push(`${name}: peerDependency ${JSON.stringify(peer)} must satisfy verified ${expected}`);
		}
	}
	try {
		const manifestPath = require.resolve(`${name}/package.json`);
		const actual = JSON.parse(await readFile(manifestPath, "utf8")).version;
		if (actual !== expected) failures.push(`${name}: expected ${expected}, found ${actual}`);
	} catch {
		failures.push(`${name}: package is unavailable`);
	}
}

const platform = await readDshClientPlatformContract().catch((error) => {
	failures.push(error instanceof Error ? error.message : "client platform contract is unavailable");
	return null;
});
if (platform !== null && platform.version !== bom.verified.packages["@deepseek-ai/dsh-client-web"]) {
	failures.push(`client platform version ${platform.version} does not match verified BOM`);
}

if (failures.length > 0) {
	throw new Error(`DSH BOM check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
}
console.log(`verified ${bom.verified.id} (${Object.keys(bom.verified.packages).length} exact packages; engines.dsh ${enginesDsh})`);
