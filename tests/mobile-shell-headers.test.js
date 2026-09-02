import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import nacl from "tweetnacl";
import { MobileDataPlane } from "../lib/server/dataplane.js";
import { AuditLogger, DeviceRegistry, OfferRegistry } from "../lib/server/registry.js";
import { MOBILE_SHELL_CSP, MOBILE_SHELL_SECURITY_HEADERS } from "../lib/shared/mobile-shell-headers.js";

function silentLogger() {
	return { debug() {}, info() {}, warn() {}, error() {} };
}

function stubUpstream() {
	return {
		addSubscriber() {},
		removeSubscriber() {},
		subscribeSession() {},
		unsubscribeSession() {},
		subscribeHost() {},
		async list() {
			return { ok: false, error: { code: "upstream_error", message: "unused" } };
		},
		async history() {
			return { ok: false, error: { code: "upstream_error", message: "unused" } };
		},
		async prompt() {
			return { ok: false, error: { code: "upstream_error", message: "unused" } };
		},
		async cancel() {
			return { ok: false, error: { code: "upstream_error", message: "unused" } };
		},
		async create() {
			return { ok: false, error: { code: "upstream_error", message: "unused" } };
		},
		async respond() {
			return { ok: false, error: { code: "upstream_error", message: "unused" } };
		},
		stop() {},
	};
}

function createPlane(mobileDir) {
	const storage = mkdtempSync(join(tmpdir(), "dshmr-csp-"));
	return new MobileDataPlane({
		serverKeyPair: nacl.box.keyPair(),
		registry: new DeviceRegistry(storage),
		offers: new OfferRegistry(),
		audit: new AuditLogger(storage),
		logger: silentLogger(),
		mobileDir,
		port: 0,
		upstream: stubUpstream(),
	});
}

test("mobile shell CSP forbids framing, inline scripts, and form posts", () => {
	assert.match(MOBILE_SHELL_CSP, /default-src 'none'/);
	assert.match(MOBILE_SHELL_CSP, /script-src 'self'/);
	assert.doesNotMatch(MOBILE_SHELL_CSP, /script-src[^;]*'unsafe-inline'/);
	assert.match(MOBILE_SHELL_CSP, /style-src 'self' 'unsafe-inline'/);
	assert.match(MOBILE_SHELL_CSP, /connect-src 'self' ws: wss:/);
	assert.match(MOBILE_SHELL_CSP, /frame-ancestors 'none'/);
	assert.match(MOBILE_SHELL_CSP, /form-action 'none'/);
	assert.equal(MOBILE_SHELL_SECURITY_HEADERS["x-frame-options"], "DENY");
	assert.equal(MOBILE_SHELL_SECURITY_HEADERS["x-content-type-options"], "nosniff");
	assert.equal(MOBILE_SHELL_SECURITY_HEADERS["referrer-policy"], "no-referrer");
});

test("data-plane /m/ responses include CSP and frame-ancestors deny", async () => {
	const dir = mkdtempSync(join(tmpdir(), "dshmr-static-"));
	writeFileSync(join(dir, "index.html"), "<html><head></head><body>ok</body></html>");
	const plane = createPlane(dir);
	try {
		await plane.listen("127.0.0.1");
		const port = plane.boundPort;
		assert.equal(typeof port, "number");
		const response = await fetch(`http://127.0.0.1:${String(port)}/m/`);
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("content-security-policy"), MOBILE_SHELL_CSP);
		assert.equal(response.headers.get("x-frame-options"), "DENY");
		assert.equal(response.headers.get("x-content-type-options"), "nosniff");
		assert.equal(response.headers.get("referrer-policy"), "no-referrer");
		assert.equal(await response.text(), "<html><head></head><body>ok</body></html>");
	} finally {
		await plane.close();
	}
});

test("data-plane 404 and 302 also carry the shell security headers", async () => {
	const dir = mkdtempSync(join(tmpdir(), "dshmr-static-"));
	writeFileSync(join(dir, "index.html"), "<html></html>");
	const plane = createPlane(dir);
	try {
		await plane.listen("127.0.0.1");
		const port = plane.boundPort;
		const missing = await fetch(`http://127.0.0.1:${String(port)}/m/no-such-file`);
		assert.equal(missing.status, 404);
		assert.equal(missing.headers.get("content-security-policy"), MOBILE_SHELL_CSP);
		assert.equal(missing.headers.get("x-frame-options"), "DENY");
		const redirect = await fetch(`http://127.0.0.1:${String(port)}/m`, { redirect: "manual" });
		assert.equal(redirect.status, 302);
		assert.equal(redirect.headers.get("location"), "/m/");
		assert.equal(redirect.headers.get("content-security-policy"), MOBILE_SHELL_CSP);
	} finally {
		await plane.close();
	}
});
