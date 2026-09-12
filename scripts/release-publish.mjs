#!/usr/bin/env node
/**
 * Maintainer-only final gate + npm publish.
 * The operator runs this after `npm login`; OTP stays in the terminal.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const registry = "https://registry.npmjs.org/";
const publishTag = typeof manifest.version === "string" && manifest.version.includes("-") ? "next" : "latest";

function run(command, args) {
	let executable = command;
	let executableArgs = args;
	if (process.platform === "win32" && command === "pnpm") {
		const pnpmCli =
			process.env.npm_execpath !== undefined && /pnpm/i.test(process.env.npm_execpath)
				? process.env.npm_execpath
				: process.env.APPDATA === undefined
					? undefined
					: join(process.env.APPDATA, "npm/node_modules/pnpm/bin/pnpm.cjs");
		if (pnpmCli === undefined || !existsSync(pnpmCli)) throw new Error("pnpm CLI path is unavailable on Windows");
		executable = process.execPath;
		executableArgs = [pnpmCli, ...args];
	} else if (process.platform === "win32" && command === "npm") {
		const npmCli = join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
		if (existsSync(npmCli)) {
			executable = process.execPath;
			executableArgs = [npmCli, ...args];
		}
	}
	const result = spawnSync(executable, executableArgs, { cwd: root, env: process.env, stdio: "inherit", shell: false });
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, [join(root, "scripts/release.mjs"), "--dry-run"]);
run("npm", ["publish", "--access", "public", "--tag", publishTag, "--registry", registry]);
run("npm", ["view", manifest.name, "version", "--registry", registry]);
run("npm", ["view", manifest.name, "dist-tags", "--registry", registry]);
