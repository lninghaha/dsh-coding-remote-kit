import assert from "node:assert/strict";
import test from "node:test";
import {
	createOwnerRequestPolicy,
	isLoopbackAddress,
	isLoopbackRequest,
	isTrustedManagementRequest,
	MAX_JSON_BODY_BYTES,
	OWNER_CSRF_HEADER,
	OWNER_PROOF_HEADER,
	passesBrowserContextGuard,
	passesCsrfGuard,
	readJsonBody,
	safeguardOwnerRequestPolicy,
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

test("a Caddy trusted Host is not owner authentication", () => {
	const viaCaddy = {
		socket: { remoteAddress: "127.0.0.1" },
		headers: { host: "gui.example.com" },
	};
	assert.equal(isTrustedManagementRequest(viaCaddy, []), false);
	assert.equal(isTrustedManagementRequest(viaCaddy, ["gui.example.com"]), false);
	assert.equal(
		isTrustedManagementRequest({ socket: { remoteAddress: "8.8.8.8" }, headers: { host: "gui.example.com" } }, [
			"gui.example.com",
		]),
		false,
	);
	assert.deepEqual(trustedHostsFromRuntime({ trustedHosts: ["gui.example.com"] }), ["gui.example.com"]);
});

function ownerRequest({
	host,
	origin,
	remoteAddress = "127.0.0.1",
	method = "GET",
	secFetchSite,
	headers = {},
}) {
	return {
		method,
		socket: { remoteAddress },
		headers: {
			...(host === undefined ? {} : { host }),
			...(origin === undefined ? {} : { origin }),
			...(secFetchSite === undefined ? {} : { "sec-fetch-site": secFetchSite }),
			...headers,
		},
	};
}

test("OwnerRequestPolicy keeps strict loopback and SSH access", () => {
	const local = createOwnerRequestPolicy();
	assert.deepEqual(
		local.authorize(ownerRequest({ host: "127.0.0.1:3080", origin: "http://127.0.0.1:3080" })),
		{ authorized: true, accessMode: "loopback" },
	);
	assert.equal(
		local.authorize(ownerRequest({ host: "gui.example.com", origin: "https://gui.example.com" })).authorized,
		false,
	);
	const ssh = createOwnerRequestPolicy({ loopbackAccessMode: "ssh-tunnel" });
	assert.deepEqual(ssh.authorize(ownerRequest({ host: "localhost:3080", origin: "http://localhost:3080" })), {
		authorized: true,
		accessMode: "ssh-tunnel",
	});
});

test("a malformed or throwing host owner policy fails closed", () => {
	for (const policy of [
		{ authorize() { throw new Error("host churn"); }, diagnostics() { throw new Error("host churn"); } },
		{ authorize() { return { authorized: true }; }, diagnostics() { return ["not-a-diagnostic"]; } },
	]) {
		const guarded = safeguardOwnerRequestPolicy(policy);
		assert.equal(guarded.authorize(ownerRequest({ host: "127.0.0.1:3080" })).authorized, false);
		assert.equal(guarded.diagnostics()[0].level, "error");
	}
});

test("trusted proxy needs exact peer, HTTPS origin, owner proof, Fetch Metadata, and mutation CSRF", () => {
	const policy = createOwnerRequestPolicy({
		trustedProxy: {
			peers: ["127.0.0.1"],
			origins: ["https://gui.example.com"],
			ownerProof: "owner-proof-secret",
			csrfToken: "csrf-proof-secret",
		},
	});
	const headers = {
		[OWNER_PROOF_HEADER]: "owner-proof-secret",
		[OWNER_CSRF_HEADER]: "csrf-proof-secret",
	};
	const complete = ownerRequest({
		host: "gui.example.com",
		origin: "https://gui.example.com",
		method: "POST",
		secFetchSite: "same-origin",
		headers,
	});
	assert.deepEqual(policy.authorize(complete), {
		authorized: true,
		accessMode: "trusted-https-proxy",
	});
	for (const missing of ["host", "origin", "sec-fetch-site", OWNER_PROOF_HEADER, OWNER_CSRF_HEADER]) {
		const copy = {
			...complete,
			headers: { ...complete.headers },
		};
		delete copy.headers[missing];
		assert.equal(policy.authorize(copy).authorized, false, `missing ${missing} must fail closed`);
	}
	assert.equal(
		policy.authorize({
			...complete,
			socket: { remoteAddress: "192.0.2.24" },
			headers: {
				...complete.headers,
				"x-forwarded-for": "127.0.0.1",
				"x-forwarded-host": "gui.example.com",
			},
		}).authorized,
		false,
	);
});

test("incomplete or reused proxy secrets disable remote access without disabling loopback", () => {
	for (const trustedProxy of [
		{ peers: ["127.0.0.1"], origins: ["https://gui.example.com"], ownerProof: "owner" },
		{
			peers: ["127.0.0.1"],
			origins: ["https://gui.example.com"],
			ownerProof: "same",
			csrfToken: "same",
		},
	]) {
		const policy = createOwnerRequestPolicy({ trustedProxy });
		assert.equal(
			policy.authorize(
				ownerRequest({
					host: "gui.example.com",
					origin: "https://gui.example.com",
					method: "POST",
					secFetchSite: "same-origin",
					headers: { [OWNER_PROOF_HEADER]: "owner", [OWNER_CSRF_HEADER]: "csrf" },
				}),
			).authorized,
			false,
		);
		assert.equal(policy.diagnostics().some((item) => item.level === "error"), true);
		assert.equal(
			policy.authorize(ownerRequest({ host: "127.0.0.1:3080", origin: "http://127.0.0.1:3080" })).authorized,
			true,
		);
	}
});

test("legacy browser-context helper only compares Origin with Host", () => {
	assert.equal(
		passesBrowserContextGuard({
			headers: { host: "gui.example.com", origin: "https://gui.example.com" },
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

test("legacy browser-context helper does not trust a public Referer allowlist", () => {
	assert.equal(
		passesBrowserContextGuard({
			headers: {
				host: "127.0.0.1:3080",
				origin: "http://127.0.0.1:3080",
				referer: "https://gui.example.com/",
			},
		}),
		true,
	);
	assert.equal(
		passesBrowserContextGuard(
			{
				headers: {
					host: "127.0.0.1:3080",
					referer: "https://gui.example.com/",
				},
			},
			["gui.example.com"],
		),
		false,
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
