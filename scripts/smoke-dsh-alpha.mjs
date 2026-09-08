#!/usr/bin/env node
/**
 * Isolated DSH 0.1.2-alpha smoke for dsh-coding-remote-kit.
 * Does not touch operator dsh-web / ports 3080|6879.
 */
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, cpSync, openSync, readFileSync, rmSync, writeFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALPHA = process.env.DSH_ALPHA_VERSION || "0.1.2-alpha.5";
const WEB_PORT = Number(process.env.WEB_PORT || 18382);
const DATA_PORT = Number(process.env.DATA_PORT || 16879);
// Never inherit or remove an operator profile. Each smoke owns a sentinel-marked
// temporary root, including its CLI installation, and cleans only that root.
const smokeRoot = mkdtempSync(join(process.env.SMOKE_TMPDIR || tmpdir(), "dsh-remote-kit-smoke-"));
const CLI_PREFIX = join(smokeRoot, "cli");
const DSH_HOME = join(smokeRoot, "home");
const SENTINEL = join(smokeRoot, ".dsh-remote-kit-smoke-owned");
const PKG = "@deepseek-ai/dsh";

function cleanupSmokeRoot() {
	try {
		if (existsSync(SENTINEL)) rmSync(smokeRoot, { recursive: true, force: true });
	} catch {}
}
process.once("exit", cleanupSmokeRoot);

function assertSmokePorts(webPort, dataPort) {
	for (const port of [webPort, dataPort]) {
		if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 3080 || port === 6879) {
			throw new Error("smoke ports must be valid and must not use 3080/6879");
		}
	}
	if (webPort === dataPort) throw new Error("WEB_PORT and DATA_PORT must differ");
}

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
writeFileSync(SENTINEL, "owned by smoke-dsh-alpha\n", { mode: 0o600 });
log("using an isolated temporary DSH profile");
log(`WEB_PORT=${WEB_PORT}`);
assertSmokePorts(WEB_PORT, DATA_PORT);
log(`DATA_PORT=${DATA_PORT}`);

mkdirSync(CLI_PREFIX, { recursive: true });
log("installing prefix CLI…");
run("npm", ["install", "--prefix", CLI_PREFIX, `${PKG}@${ALPHA}`], { cwd: ROOT });
const dshBin = join(CLI_PREFIX, "node_modules", ".bin", "dsh");
if (!existsSync(dshBin)) throw new Error(`missing ${dshBin}`);
log(`dsh --version => ${run(dshBin, ["--version"]).trim()}`);

log("packing plugin…");
run("pnpm", ["run", "release:pack"], { cwd: ROOT });
const outputDir = join(ROOT, "output");
const tgzName = readdirSync(outputDir).filter((name) => /^dsh-coding-remote-kit-.*\.tgz$/u.test(name)).sort().at(-1);
if (tgzName === undefined) throw new Error("no pack tarball");
const tgz = join(outputDir, tgzName);

mkdirSync(join(DSH_HOME, "packages"), { recursive: true });
const destTgz = join(DSH_HOME, "packages", tgz.split("/").at(-1));
cpSync(tgz, destTgz);

const env = { ...process.env, DSH_HOME };
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
let child;
let childDone;
let childFailure;
try {
	child = spawn(dshBin, ["web", "--port", String(WEB_PORT), "--no-open"], {
	env,
	stdio: ["ignore", logFd, logFd],
	});
	let rejectFailure;
	childFailure = new Promise((_, reject) => { rejectFailure = reject; });
	childDone = new Promise((resolve) => {
		child.once("exit", (code, signal) => {
			rejectFailure(new Error(`dsh web exited (${String(code ?? signal)})`));
			resolve();
		});
		child.once("error", (error) => {
			rejectFailure(new Error(`dsh web failed to spawn (${error instanceof Error ? error.message : "error"})`));
			resolve();
		});
	});
} catch (error) {
	closeSync(logFd);
	throw error;
}

let failed = false;
try {
	const webBase = `http://127.0.0.1:${WEB_PORT}`;
	await Promise.race([waitHttp(`${webBase}/`), childFailure]);
	log(`GET / => web up on ${WEB_PORT}`);
	// Mobile shell + CSP live on the data-plane port, not dsh web.
	const dataBase = `http://127.0.0.1:${DATA_PORT}`;
	await Promise.race([waitHttp(`${dataBase}/m/`), childFailure]);
	const mobile = await fetch(`${dataBase}/m/`, { redirect: "manual" });
	const csp = mobile.headers.get("content-security-policy") || "";
	log(`GET data-plane /m/ => ${mobile.status}; CSP=${csp.slice(0, 180)}`);
	if (!/frame-ancestors/i.test(csp)) throw new Error("expected CSP frame-ancestors on data-plane /m/");
	log("PASS: data-plane /m/ CSP present");
	log("NOTE: claim/WS limiter remain manual follow-ups when a live offer exists.");
} catch (error) {
	failed = true;
	console.error(error);
} finally {
	try { child.kill("SIGTERM"); } catch {}
	await childDone;
	childFailure.catch(() => {});
	closeSync(logFd);
}
cleanupSmokeRoot();
if (failed) process.exit(1);
log("OK — isolated DSH alpha smoke passed");
