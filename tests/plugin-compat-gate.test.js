import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import semver from "semver";

/**
 * Mirror of `@deepseek-ai/dsh-app-boot` `evaluatePluginCompatibility` /
 * `unmetRequirements`: own `engines.dsh` decides alone; otherwise every
 * `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` peer must satisfy the runtime
 * (`includePrerelease: true`).
 */
function unmetRequirements(fields, runtimeVersion) {
	const engines = fields.engines ?? {};
	if (Object.hasOwn(engines, "dsh")) {
		const range = engines.dsh;
		if (typeof range !== "string") throw new Error("Plugin manifest engines.dsh must be a string");
		const ok = range.trim() !== "" && semver.satisfies(runtimeVersion, range, { includePrerelease: true });
		return ok ? {} : { "engines.dsh": range };
	}
	const dependencies = fields.peerDependencies ?? {};
	const unmet = {};
	for (const [name, range] of Object.entries(dependencies)) {
		if (typeof range !== "string") throw new Error(`peerDependencies[${name}] must be a string`);
		if (name !== "@deepseek-ai/dsh" && !name.startsWith("@deepseek-ai/dsh-")) continue;
		const effective = ["workspace:^", "workspace:~", "workspace:*"].includes(range) ? runtimeVersion : range;
		if (!semver.satisfies(runtimeVersion, effective, { includePrerelease: true })) unmet[name] = range;
	}
	return unmet;
}

function evaluatePluginCompatibility(manifest, runtimeVersion) {
	const requirements = unmetRequirements(manifest, runtimeVersion);
	if (Object.keys(requirements).length === 0) return undefined;
	return {
		name: manifest.name,
		version: manifest.version,
		runtimeVersion,
		requirements,
	};
}

test("current package.json accepts DSH 0.1.1-rc.2 and 0.2.1-rc.2, rejects 0.3.0", async () => {
	const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
	assert.equal(typeof pkg.engines?.dsh, "string");
	assert.equal(evaluatePluginCompatibility(pkg, "0.1.1-rc.2"), undefined);
	assert.equal(evaluatePluginCompatibility(pkg, "0.2.1-rc.2"), undefined);
	const rejected = evaluatePluginCompatibility(pkg, "0.3.0");
	assert.ok(rejected);
	assert.deepEqual(rejected.requirements, { "engines.dsh": pkg.engines.dsh });
});

test("without engines.dsh, exact 0.1.1-rc.2 peers reject 0.2.1-rc.2 (host fallback path)", () => {
	const legacy = {
		name: "dsh-coding-remote-kit",
		version: "0.7.1",
		peerDependencies: {
			"@deepseek-ai/dsh-host-webserver": "0.1.1-rc.2",
			"@deepseek-ai/dsh-client-ui-settings": "0.1.1-rc.2",
		},
	};
	assert.equal(evaluatePluginCompatibility(legacy, "0.1.1-rc.2"), undefined);
	const rejected = evaluatePluginCompatibility(legacy, "0.2.1-rc.2");
	assert.ok(rejected);
	assert.equal(rejected.requirements["@deepseek-ai/dsh-host-webserver"], "0.1.1-rc.2");
});
