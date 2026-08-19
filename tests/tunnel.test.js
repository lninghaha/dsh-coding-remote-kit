import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import {
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
	const tunnel = new CloudflareQuickTunnel({
		binary: "/fake/cloudflared",
		spawn(_command, args) {
			spawnedArgs = args;
			return child;
		},
	});
	const startPromise = tunnel.start({ port: 6879, timeoutMs: 2000 });
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

test("URL without Registered tunnel connection does not resolve", async () => {
	const child = fakeChild();
	const tunnel = new CloudflareQuickTunnel({
		binary: "/fake/cloudflared",
		spawn() {
			return child;
		},
	});
	const startPromise = tunnel.start({ port: 6879, timeoutMs: 40 });
	child.stderr.write("https://only-url.trycloudflare.com\n");
	await assert.rejects(startPromise, /timed out waiting for the tunnel to register/);
	assert.equal(child.killed, true);
});

test("start times out (and kills the child) when no URL appears", async () => {
	const child = fakeChild();
	const tunnel = new CloudflareQuickTunnel({
		binary: "/fake/cloudflared",
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
	const tunnel = new CloudflareQuickTunnel({
		binary: "/fake/cloudflared",
		spawn() {
			return child;
		},
	});
	const startPromise = tunnel.start({ port: 6879, timeoutMs: 2000 });
	child.emit("exit", 1, "SIGTERM");
	await assert.rejects(startPromise, /exited/);
	assert.equal(tunnel.snapshot().running, false);
});

test("tunnelAdvertise maps the public URL to /m and wss /m/ws with host-only candidates", () => {
	assert.deepEqual(tunnelAdvertise("https://abc-123.trycloudflare.com"), {
		endpoint: "wss://abc-123.trycloudflare.com/m/ws",
		pageUrl: "https://abc-123.trycloudflare.com/m",
		candidates: ["abc-123.trycloudflare.com"],
	});
});

test("resolveCloudflaredBinary returns a string command or null (never spawns)", () => {
	const binary = resolveCloudflaredBinary();
	assert.ok(binary === null || typeof binary === "string");
});
