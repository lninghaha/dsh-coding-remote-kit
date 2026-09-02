#!/usr/bin/env node
/**
 * Isolated DSH 0.1.2-alpha smoke for dsh-coding-remote-kit.
 * Does not touch operator dsh-web / ports 3080|6879.
 */
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, cpSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALPHA = process.env.DSH_ALPHA_VERSION || "0.1.2-alpha.5";
const WEB_PORT = Number(process.env.WEB_PORT || 18382);
const DATA_PORT = Number(process.env.DATA_PORT || 16879);
const CLI_PREFIX = process.env.DSH_CLI_PREFIX || `/tmp/dsh-cli-${ALPHA}`;
const DSH_HOME = process.env.DSH_HOME || `/tmp/dsh-verify-remote-kit-${ALPHA}`;
const PKG = "@deepseek-ai/dsh";

function run(cmd, args, opts = {}) {
	const r = spawnSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts });
	if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}\n${r.stdout}\n${r.stderr}`);
	return r.stdout;
}
const log = (m) => process.stdout.write(`${m}\n`);
async function waitHttp(url, timeoutMs = 90_000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(url, { redirect: "manual" });
			if (res.status > 0) return res;
		} catch {}
		await new Promise((r) => setTimeout(r, 400));
	}
	throw new Error(`timeout waiting for ${url}`);
}

log(`== smoke ${PKG}@${ALPHA} remote-kit ==`);
log(`DSH_HOME=${DSH_HOME}`);
log(`WEB_PORT=${WEB_PORT}`);
if (WEB_PORT === 3080 || WEB_PORT === 6879 || DATA_PORT === 6879) throw new Error("refusing operator ports 3080/6879");
log(`DATA_PORT=${DATA_PORT}`);

mkdirSync(CLI_PREFIX, { recursive: true });
log("installing prefix CLI…");
run("npm", ["install", "--prefix", CLI_PREFIX, `${PKG}@${ALPHA}`], { cwd: ROOT });
const dshBin = join(CLI_PREFIX, "node_modules", ".bin", "dsh");
if (!existsSync(dshBin)) throw new Error(`missing ${dshBin}`);
log(`dsh --version => ${run(dshBin, ["--version"]).trim()}`);

log("packing plugin…");
run("pnpm", ["run", "release:pack"], { cwd: ROOT });
const tgz = run("bash", ["-lc", `ls -1 ${ROOT}/output/dsh-coding-remote-kit-*.tgz | tail -1`]).trim();
if (!tgz) throw new Error("no pack tarball");

rmSync(DSH_HOME, { recursive: true, force: true });
mkdirSync(join(DSH_HOME, "packages"), { recursive: true });
const destTgz = join(DSH_HOME, "packages", tgz.split("/").at(-1));
cpSync(tgz, destTgz);

const env = { ...process.env, DSH_HOME, HOME: homedir() };
run(dshBin, ["plugin", "--profile", "web", "add", destTgz], { env });

// Avoid colliding with operator/other smokes on the default data-plane 6879.
const patchPath = join(DSH_HOME, "profiles", "web", "node_modules", "dsh-coding-remote-kit", "cordis.patch.yml");
if (!existsSync(patchPath)) throw new Error(`missing ${patchPath}`);
const patched = readFileSync(patchPath, "utf8").replace(/port:\s*6879/, `port: ${DATA_PORT}`);
if (!patched.includes(`port: ${DATA_PORT}`)) throw new Error("failed to retarget data-plane port");
writeFileSync(patchPath, patched);
log(`retargeted mobile-remote data plane -> ${DATA_PORT}`);

const logFile = join(DSH_HOME, "smoke-web.log");
const logFd = openSync(logFile, "w");
const child = spawn(dshBin, ["web", "--port", String(WEB_PORT), "--no-open"], {
	env,
	stdio: ["ignore", logFd, logFd],
});

let failed = false;
try {
	const base = `http://127.0.0.1:${WEB_PORT}`;
	await waitHttp(`${base}/`);
	const mobile = await fetch(`${base}/m/`, { redirect: "manual" });
	const csp = mobile.headers.get("content-security-policy") || "";
	log(`GET /m/ => ${mobile.status}; CSP=${csp.slice(0, 180)}`);
	if (!/frame-ancestors/i.test(csp)) throw new Error("expected CSP frame-ancestors on /m/");
	log("PASS: /m/ CSP present");
	log("NOTE: claim/WS limiter remain manual follow-ups when a live offer exists.");
} catch (error) {
	failed = true;
	console.error(error);
} finally {
	child.kill("SIGTERM");
	await new Promise((r) => child.on("exit", r));
	closeSync(logFd);
}
if (failed) process.exit(1);
log(`OK — comment on GitHub #12 (log: ${logFile})`);
