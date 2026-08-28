import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EventEmitter } from "node:events";
import {
	BinaryUntrustedError,
	CloudflareQuickTunnel,
	parseQuickTunnelUrl,
	resolveCloudflaredBinary,
} from "../lib/server/tunnel.js";
import { tunnelAdvertise } from "../lib/server/routes.js";

function fakeStream() {
	const stream = new EventEmitter();
	stream.write = (chunk) => {
		stream.emit("data", chunk);
		return true;
	};
	return stream;
}

function fakeChild() {
	const listeners = new Map();
	const child = {
		pid: 4242,
		stderr: fakeStream(),
		stdout: fakeStream(),
		killed: false,
		kill() {
			this.killed = true;
			return true;
		},
		on(event, listener) {
			if (!listeners.has(event)) listeners.set(event, new Set());
			listeners.get(event).add(listener);
			return this;
		},
		emit(event, ...args) {
			for (const listener of listeners.get(event) ?? []) listener(...args);
		},
	};
	return child;
}

function tempBinaryPath() {
	const dir = mkdtempSync(join(tmpdir(), "dshmr-tunnel-"));
	const path = join(dir, "cloudflared");
	writeFileSync(path, "fake-cloudflared");
	return path;
}

function okVerify(path) {
	return {
		ok: true,
		status: "ok",
		path,
		sha256: "a".repeat(64),
		release: "2026.8.2",
	};
}

test("parses trycloudflare.com URL from a sample cloudflared banner", () => {
	const banner = `INFO[0001] Cannot determine default configuration path. No file found at ~/.cloudflared/config.yml
INFO[0001] Acquiring Quick Tunnel
Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):
https://random-name-1a2b.trycloudflare.com
+--------------------------------------------------------------------------------------------+`;
	assert.equal(
		parseQuickTunnelUrl(banner),
		"https://random-name-1a2b.trycloudflare.com",
	);
});

test("parseQuickTunnelUrl rejects non-trycloudflare URLs", () => {
	for (const bad of [
		"https://example.com",
		"http://127.0.0.1:6879/m",
		"wss://foo.cloudflared.com/m/ws",
		"smoke.com/trycloudflare.com",
		"no url here",
	]) {
		assert.equal(parseQuickTunnelUrl(bad), null, bad);
	}
});

test("start returns the URL from stderr then stop kills the child (no real tunnel)", async () => {
	const child = fakeChild();
	let spawnedArgs = null;
	let spawnedResolve;
	const spawned = new Promise((resolve) => {
		spawnedResolve = resolve;
	});
	const binary = tempBinaryPath();
	const tunnel = new CloudflareQuickTunnel({
		binary,
		verifyBinary: okVerify,
		spawn(_command, args) {
			spawnedArgs = args;
			spawnedResolve();
			return child;
		},
	});
	const startPromise = tunnel.start({ port: 6879, timeoutMs: 2000 });
	await spawned;
	await new Promise((resolve) => setImmediate(resolve));
	child.stderr.write("... connecting\n");
	child.stderr.write("https://happy-photo-7qx.trycloudflare.com\n");
	child.stderr.write("Registered tunnel connection connIndex=0 location=nrt12 protocol=http2\n");
	const url = await startPromise;
	assert.equal(url, "https://happy-photo-7qx.trycloudflare.com");
	assert.ok(spawnedArgs.includes("tunnel"));
	assert.ok(spawnedArgs.includes("--url"));
	assert.ok(spawnedArgs.includes("http://127.0.0.1:6879"));
	assert.ok(spawnedArgs.includes("--no-autoupdate"));
	assert.ok(spawnedArgs.includes("--protocol"));
	assert.ok(spawnedArgs.includes("http2"));
	assert.equal(tunnel.snapshot().running, true);
	assert.equal(tunnel.snapshot().kind, "cloudflare-quick");
	assert.equal(tunnel.snapshot().url, url);
	await tunnel.stop();
	assert.equal(child.killed, true);
	assert.equal(tunnel.snapshot().running, false);
	assert.equal(tunnel.snapshot().kind, null);
});

test("start refuses unverified binary (binary-untrusted)", async () => {
	const binary = tempBinaryPath();
	const tunnel = new CloudflareQuickTunnel({
		binary,
		verifyBinary: () => ({
			ok: false,
			status: "hash-mismatch",
			path: binary,
			message: "mismatch",
		}),
		spawn() {
			throw new Error("must not spawn");
		},
	});
	await assert.rejects(tunnel.start({ port: 6879, timeoutMs: 100 }), BinaryUntrustedError);
	assert.equal(tunnel.snapshot().binaryOk, false);
});

test("binaryOk recovers after verify flips from mismatch to ok (same path)", async () => {
	const binary = tempBinaryPath();
	let mismatch = true;
	const tunnel = new CloudflareQuickTunnel({
		binary,
		verifyBinary: (path) =>
			mismatch
				? { ok: false, status: "hash-mismatch", path, message: "mismatch" }
				: okVerify(path),
		spawn() {
			throw new Error("must not spawn");
		},
	});
	assert.equal(tunnel.binaryOk, false);
	await assert.rejects(tunnel.start({ port: 6879, timeoutMs: 100 }), BinaryUntrustedError);
	mismatch = false;
	assert.equal(tunnel.binaryOk, true);
});

test("start re-resolves live when construct-time binary was missing", async () => {
	const child = fakeChild();
	let spawnedResolve;
	const spawned = new Promise((resolve) => {
		spawnedResolve = resolve;
	});
	const prev = process.env.CLOUDFLARED;
	process.env.CLOUDFLARED = "/nonexistent/dshmr-cloudflared";
	const tunnel = new CloudflareQuickTunnel({
		verifyBinary: okVerify,
		spawn(_command, _args) {
			spawnedResolve();
			return child;
		},
	});
	assert.equal(tunnel.binaryOk, false);
	await assert.rejects(tunnel.start({ port: 6879, timeoutMs: 100 }), /not found|untrusted|could not be resolved/);
	const binary = tempBinaryPath();
	process.env.CLOUDFLARED = binary;
	try {
		assert.equal(tunnel.binaryOk, true);
		const startPromise = tunnel.start({ port: 6879, timeoutMs: 2000 });
		await spawned;
		await new Promise((resolve) => setImmediate(resolve));
		child.stderr.write("https://happy-photo-7qx.trycloudflare.com\n");
		child.stderr.write("Registered tunnel connection connIndex=0\n");
		const url = await startPromise;
		assert.equal(url, "https://happy-photo-7qx.trycloudflare.com");
	} finally {
		if (prev === undefined) delete process.env.CLOUDFLARED;
		else process.env.CLOUDFLARED = prev;
	}
});

test("start rejects bare PATH binary names as untrusted", async () => {
	const tunnel = new CloudflareQuickTunnel({
		binary: "cloudflared",
		spawn() {
			throw new Error("must not spawn");
		},
	});
	await assert.rejects(tunnel.start({ port: 6879, timeoutMs: 100 }), /non-absolute|bare PATH/);
});

test("start rejects relative binary paths as untrusted", async () => {
	const tunnel = new CloudflareQuickTunnel({
		binary: "./cloudflared",
		spawn() {
			throw new Error("must not spawn");
		},
	});
	await assert.rejects(tunnel.start({ port: 6879, timeoutMs: 100 }), /non-absolute/);
});

test("URL without Registered tunnel connection does not resolve", async () => {
	const child = fakeChild();
	let spawnedResolve;
	const spawned = new Promise((resolve) => {
		spawnedResolve = resolve;
	});
	const tunnel = new CloudflareQuickTunnel({
		binary: tempBinaryPath(),
		verifyBinary: okVerify,
		spawn() {
			spawnedResolve();
			return child;
		},
	});
	const startPromise = tunnel.start({ port: 6879, timeoutMs: 40 });
	await spawned;
	await new Promise((resolve) => setImmediate(resolve));
	child.stderr.write("https://only-url.trycloudflare.com\n");
	await assert.rejects(startPromise, /timed out waiting for the tunnel to register/);
	assert.equal(child.killed, true);
});

test("start times out (and kills the child) when no URL appears", async () => {
	const child = fakeChild();
	const tunnel = new CloudflareQuickTunnel({
		binary: tempBinaryPath(),
		verifyBinary: okVerify,
		spawn() {
			return child;
		},
	});
	await assert.rejects(
		tunnel.start({ port: 6879, timeoutMs: 30 }),
		/timed out/,
	);
	assert.equal(child.killed, true);
	assert.equal(tunnel.snapshot().running, false);
});

test("start rejects when the child exits before publishing a URL", async () => {
	const child = fakeChild();
	let spawnedResolve;
	const spawned = new Promise((resolve) => {
		spawnedResolve = resolve;
	});
	const tunnel = new CloudflareQuickTunnel({
		binary: tempBinaryPath(),
		verifyBinary: okVerify,
		spawn() {
			spawnedResolve();
			return child;
		},
	});
	const startPromise = tunnel.start({ port: 6879, timeoutMs: 2000 });
	await spawned;
	await new Promise((resolve) => setImmediate(resolve));
	child.emit("exit", 1, "SIGTERM");
	await assert.rejects(startPromise, /exited/);
	assert.equal(tunnel.snapshot().running, false);
});

test("tunnelAdvertise maps the public URL to /m and wss /m/ws with host-only candidates", () => {
	assert.deepEqual(tunnelAdvertise("https://abc-123.trycloudflare.com"), {
		endpoint: "wss://abc-123.trycloudflare.com/m/ws",
		pageUrl: "https://abc-123.trycloudflare.com/m/",
		candidates: ["abc-123.trycloudflare.com"],
	});
});

test("resolveCloudflaredBinary returns absolute path or null (never bare name)", () => {
	const binary = resolveCloudflaredBinary();
	assert.ok(binary === null || typeof binary === "string");
	if (binary !== null) {
		assert.ok(binary.includes("/") || binary.includes("\\"));
	}
});
