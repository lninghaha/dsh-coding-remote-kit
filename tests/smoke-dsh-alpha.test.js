import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

// Stage markers prove each intended failure was actually reached.
function setup(dir) {
 writeFileSync(join(dir, "npm"), `#!/bin/sh
echo install >> "$SMOKE_TRACE"
if [ "\${FAKE_INSTALL_EXIT:-0}" != 0 ]; then exit "$FAKE_INSTALL_EXIT"; fi
mkdir -p "$3/node_modules/.bin"
cp "$FAKE_DSH" "$3/node_modules/.bin/dsh"
chmod +x "$3/node_modules/.bin/dsh"
`);
 writeFileSync(join(dir, "pnpm"), `#!/bin/sh
echo pack >> "$SMOKE_TRACE"
if [ "\${FAKE_PACK_EXIT:-0}" != 0 ]; then exit "$FAKE_PACK_EXIT"; fi
mkdir -p output; : > output/dsh-coding-remote-kit-fake.tgz
`);
 writeFileSync(join(dir, "dsh"), `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const trace = (text) => fs.appendFileSync(process.env.SMOKE_TRACE, text + "\\n");
if (process.argv[2] === "plugin") {
 trace("plugin");
 if (process.env.FAKE_PLUGIN_EXIT) process.exit(Number(process.env.FAKE_PLUGIN_EXIT));
 const dir = path.join(process.env.DSH_HOME, "profiles/web/node_modules/dsh-coding-remote-kit");
 fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "cordis.patch.yml"), "port: 6879");
 if (process.env.FAKE_SPAWN_ERROR) fs.unlinkSync(process.argv[1]);
} else if (process.argv[2] === "web") {
 trace("web:" + process.pid);
 if (process.env.FAKE_WEB_EXIT) process.exit(Number(process.env.FAKE_WEB_EXIT));
 const patch = fs.readFileSync(path.join(process.env.DSH_HOME, "profiles/web/node_modules/dsh-coding-remote-kit/cordis.patch.yml"), "utf8");
 const ports = [Number(process.argv[process.argv.indexOf("--port") + 1]), Number(patch.match(/port: (\\d+)/)[1])];
 const servers = ports.map(port => http.createServer((_req,res) => { res.writeHead(200, { "content-security-policy": "frame-ancestors 'none'" }); res.end("fixture"); }).listen(port, "127.0.0.1"));
 process.on("SIGTERM", () => { trace("terminated"); for (const server of servers) server.close(); });
} else console.log("fixture-version");
`);
 for (const name of ["npm", "pnpm", "dsh"]) chmodSync(join(dir, name), 0o755);
}

function scenario(stage, expected, success = false) {
 const outer = mkdtempSync(join(tmpdir(), "dshmr-smoke-proof-"));
 const bin = join(outer, "bin"), home = join(outer, "operator-home"), prefix = join(outer, "operator-cli");
 for (const dir of [bin, home, prefix]) mkdirSync(dir);
 for (const dir of [home, prefix]) writeFileSync(join(dir, "sentinel"), "keep");
 const trace = join(outer, "trace"); setup(bin);
 try {
  const result = spawnSync(process.execPath, ["scripts/smoke-dsh-alpha.mjs"], {
   cwd: new URL("..", import.meta.url), encoding: "utf8",
   env: { ...process.env, ...stage, DSH_HOME: home, CLI_PREFIX: prefix, SMOKE_TMPDIR: outer, SMOKE_TRACE: trace, FAKE_DSH: join(bin, "dsh"), PATH: `${bin}:${process.env.PATH}` },
  });
  if (success) assert.equal(result.status, 0, result.stderr); else assert.notEqual(result.status, 0);
  const visited = readFileSync(trace, "utf8");
  assert.match(visited, expected);
  if (stage.FAKE_WEB_EXIT) assert.ok(result.stderr.includes(`dsh web exited (${stage.FAKE_WEB_EXIT})`), result.stderr);
  if (stage.FAKE_SPAWN_ERROR) assert.match(result.stderr, /dsh web failed to spawn/);
  for (const dir of [home, prefix]) assert.equal(readFileSync(join(dir, "sentinel"), "utf8"), "keep");
  assert.equal(readdirSync(outer).some(name => name.startsWith("dsh-remote-kit-smoke-")), false);
  const pid = /web:(\d+)/.exec(visited)?.[1];
  if (pid) assert.throws(() => process.kill(Number(pid), 0), { code: "ESRCH" });
  if (success) { assert.match(visited, /terminated/); assert.match(result.stdout, /isolated DSH alpha smoke passed/); }
 } finally {
  rmSync(new URL("../output/dsh-coding-remote-kit-fake.tgz", import.meta.url), { force: true });
  rmSync(outer, { recursive: true, force: true });
 }
}

test("smoke proves install, pack, plugin, web exit and spawn-error cleanup without touching external profiles", () => {
 scenario({ FAKE_INSTALL_EXIT: "23" }, /install/);
 scenario({ FAKE_PACK_EXIT: "7" }, /pack/);
 scenario({ FAKE_PLUGIN_EXIT: "8" }, /plugin/);
 scenario({ FAKE_WEB_EXIT: "9" }, /web:\d+/);
 scenario({ FAKE_WEB_EXIT: "0" }, /web:\d+/);
 scenario({ FAKE_SPAWN_ERROR: "1" }, /plugin/);
});

test("smoke successful HTTP and CSP flow reaps its web process and preserves external profiles", () => scenario({}, /web:\d+/, true));

test("smoke refuses operator or colliding ports before invoking an installer", () => {
 for (const ports of [{ WEB_PORT: "3080", DATA_PORT: "16879" }, { WEB_PORT: "18382", DATA_PORT: "18382" }]) {
  const result = spawnSync(process.execPath, ["scripts/smoke-dsh-alpha.mjs"], { cwd: new URL("..", import.meta.url), encoding: "utf8", env: { ...process.env, ...ports } });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /smoke ports|WEB_PORT/);
 }
});
