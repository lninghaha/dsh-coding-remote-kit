import assert from "node:assert/strict";
import test from "node:test";
import {
	isLoopbackAddress,
	isLoopbackRequest,
	isTrustedManagementRequest,
	MAX_JSON_BODY_BYTES,
	passesBrowserContextGuard,
	passesCsrfGuard,
	readJsonBody,
	trustedHostsFromRuntime,
} from "../lib/server/security.js";

test("loopback address detection", () => {
	assert.equal(isLoopbackAddress("127.0.0.1"), true);
	assert.equal(isLoopbackAddress("::1"), true);
	assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
	assert.equal(isLoopbackAddress("8.8.8.8"), false);
	assert.equal(isLoopbackAddress(undefined), false);
});

test("non-loopback remote address → rejected (403 path)", () => {
	const request = {
		socket: { remoteAddress: "8.8.8.8" },
		headers: { host: "127.0.0.1:3080" },
	};
	assert.equal(isLoopbackRequest(request), false);

	const loopback = {
		socket: { remoteAddress: "127.0.0.1" },
		headers: { host: "localhost:3080" },
	};
	assert.equal(isLoopbackRequest(loopback), true);
});

test("Caddy trusted-host + loopback peer is allowed", () => {
	const viaCaddy = {
		socket: { remoteAddress: "127.0.0.1" },
		headers: { host: "dsh-x13.prepop.net" },
	};
	assert.equal(isTrustedManagementRequest(viaCaddy, []), false);
	assert.equal(isTrustedManagementRequest(viaCaddy, ["dsh-x13.prepop.net"]), true);
	assert.equal(
		isTrustedManagementRequest({ socket: { remoteAddress: "8.8.8.8" }, headers: { host: "dsh-x13.prepop.net" } }, [
			"dsh-x13.prepop.net",
		]),
		false,
	);
	assert.deepEqual(trustedHostsFromRuntime({ trustedHosts: ["dsh-x13.prepop.net"] }), ["dsh-x13.prepop.net"]);
});

test("browser-context accepts https origin matching trusted Host", () => {
	assert.equal(
		passesBrowserContextGuard({
			headers: { host: "dsh-x13.prepop.net", origin: "https://dsh-x13.prepop.net" },
		}),
		true,
	);
});

test("write without the plugin header → CSRF fail (403 path)", () => {
	assert.equal(passesCsrfGuard({ headers: { "content-type": "application/json" } }), false);
	assert.equal(
		passesCsrfGuard({ headers: { "content-type": "application/json", "x-dsh-mobile-remote": "1" } }),
		true,
	);
	assert.equal(
		passesCsrfGuard({ headers: { "content-type": "text/plain", "x-dsh-mobile-remote": "1" } }),
		false,
	);
});

test("browser-context guard rejects cross-site and mismatched origin", () => {
	assert.equal(
		passesBrowserContextGuard({ headers: { host: "127.0.0.1:3080", "sec-fetch-site": "cross-site" } }),
		false,
	);
	assert.equal(
		passesBrowserContextGuard({
			headers: { host: "127.0.0.1:3080", origin: "http://evil.example" },
		}),
		false,
	);
	assert.equal(
		passesBrowserContextGuard({
			headers: { host: "127.0.0.1:3080", origin: "http://127.0.0.1:3080" },
		}),
		true,
	);
});

function mockRequest(chunks) {
	const listeners = {};
	return {
		on(event, callback) {
			listeners[event] = callback;
			return this;
		},
		destroy() {},
		emitData() {
			for (const chunk of chunks) listeners.data?.(chunk);
		},
		emitEnd() {
			listeners.end?.();
		},
	};
}

function mockResponse() {
	const state = { status: 0, body: "" };
	return {
		writeHead(status) {
			state.status = status;
		},
		end(body) {
			state.body = body ?? "";
		},
		status: () => state.status,
		body: () => state.body,
	};
}

test("body over the 64KiB limit → 413", async () => {
	const response = mockResponse();
	const request = mockRequest([Buffer.alloc(MAX_JSON_BODY_BYTES + 1)]);
	const pending = readJsonBody(request, response);
	request.emitData();
	request.emitEnd();
	const result = await pending;
	assert.equal(result, undefined);
	assert.equal(response.status(), 413);
});

test("valid JSON body within the limit is parsed", async () => {
	const response = mockResponse();
	const request = mockRequest([Buffer.from('{"ok":true}')]);
	const pending = readJsonBody(request, response);
	request.emitData();
	request.emitEnd();
	const result = await pending;
	assert.deepEqual(result, { ok: true });
	assert.equal(response.status(), 0);
});
