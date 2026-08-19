/**
 * Management-plane guard chain (mounted on the host `webServer`).
 *
 * Every management route must pass, in order:
 *   1. loopback peer + loopback/localhost Host          (non-loopback → 403)
 *   2. browser-context: Origin/Referer, when present, must match Host;
 *      `sec-fetch-site: cross-site` is rejected          (→ 403)
 *   3. for non-GET: `Content-Type: application/json` and the custom header
 *      `x-dsh-mobile-remote: 1`                          (→ 403)
 * and the JSON body is capped at 64KiB                    (→ 413).
 *
 * All responses carry `cache-control: no-store` and `x-content-type-options:
 * nosniff`.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

export const MAX_JSON_BODY_BYTES = 64 * 1024;
export const MANAGEMENT_HEADER = "x-dsh-mobile-remote";

export function isLoopbackAddress(address: unknown): boolean {
	if (typeof address !== "string") return false;
	const normalized = address.toLowerCase();
	if (normalized === "::1") return true;
	const ipv4 = normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
	const octets = ipv4.split(".");
	return (
		octets.length === 4 &&
		octets[0] === "127" &&
		octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
	);
}

/** Normalize a Host/Origin authority hostname (strip brackets, trailing dot). */
function normalizeHostname(value: string): string | null {
	const normalized = value.toLowerCase();
	const unwrapped = normalized.startsWith("[") && normalized.endsWith("]") ? normalized.slice(1, -1) : normalized;
	const hostname = unwrapped.replace(/\.$/u, "");
	return hostname === "" ? null : hostname;
}

/** Host header → hostname (or null when malformed). */
export function hostNameOf(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const host = value.trim().toLowerCase();
	if (host.startsWith("[")) {
		const close = host.indexOf("]");
		if (close <= 1) return null;
		const suffix = host.slice(close + 1);
		if (suffix !== "" && !/^:\d+$/u.test(suffix)) return null;
		return normalizeHostname(host.slice(1, close));
	}
	const firstColon = host.indexOf(":");
	const lastColon = host.lastIndexOf(":");
	if (firstColon !== lastColon) return normalizeHostname(host);
	if (lastColon === -1) return normalizeHostname(host);
	if (!/^\d+$/u.test(host.slice(lastColon + 1))) return null;
	return normalizeHostname(host.slice(0, lastColon));
}

function portOfHost(value: string): string {
	const host = value.trim().toLowerCase();
	if (host.startsWith("[")) {
		const close = host.indexOf("]");
		const suffix = host.slice(close + 1);
		return suffix.startsWith(":") ? suffix.slice(1) : "";
	}
	const lastColon = host.lastIndexOf(":");
	return lastColon !== -1 && /^\d+$/u.test(host.slice(lastColon + 1)) ? host.slice(lastColon + 1) : "";
}

function defaultPort(protocol: string): string {
	return protocol === "https:" ? "443" : "80";
}

/** Extract {hostname, port} from an Origin/Referer URL, or null. */
function originAuthority(value: unknown): { hostname: string; port: string; protocol: string } | null {
	if (typeof value !== "string" || value.trim() === "") return null;
	try {
		const url = new URL(value);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		if (url.username !== "" || url.password !== "") return null;
		const hostname = normalizeHostname(url.hostname);
		if (hostname === null) return null;
		return { hostname, port: url.port || defaultPort(url.protocol), protocol: url.protocol };
	} catch {
		return null;
	}
}

/** Peer socket address is a loopback address and Host is loopback/localhost. */
export function isLoopbackRequest(request: IncomingMessage): boolean {
	return isTrustedManagementRequest(request, []);
}

/**
 * Management-plane trust: TCP peer must be loopback (Caddy on this machine),
 * and Host must be loopback/localhost **or** an explicit trusted host
 * (`dsh web --trusted-host`, plus plugin config). This is how the settings
 * page on `https://gui.example.com` reaches `/api/mobile-remote/*`.
 */
export function isTrustedManagementRequest(
	request: IncomingMessage,
	trustedHosts: readonly string[] = [],
): boolean {
	if (!isLoopbackAddress(request.socket.remoteAddress)) return false;
	const host = hostNameOf(request.headers.host);
	if (host === null) return false;
	if (host === "localhost" || isLoopbackAddress(host)) return true;
	const allowed = new Set(trustedHosts.map((value) => value.toLowerCase()));
	return allowed.has(host);
}

/** Collect hostnames from `ctx.get("webRuntime")` (dsh-web-app). */
export function trustedHostsFromRuntime(value: unknown): string[] {
	if (typeof value !== "object" || value === null) return [];
	const hosts = (value as { trustedHosts?: unknown }).trustedHosts;
	if (!Array.isArray(hosts)) return [];
	return hosts.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function headerMatchesHost(originValue: unknown, hostHeader: string): boolean {
	const authority = originAuthority(originValue);
	if (authority === null) return false;
	const host = hostNameOf(hostHeader);
	if (host === null) return false;
	if (authority.hostname !== host) return false;
	return authority.port === (portOfHost(hostHeader) || defaultPort(authority.protocol));
}

function hostnameInTrustedList(urlValue: unknown, trustedHosts: readonly string[]): boolean {
	const authority = originAuthority(urlValue);
	if (authority === null) return false;
	const allowed = new Set(trustedHosts.map((value) => value.toLowerCase()));
	return allowed.has(authority.hostname);
}

/**
 * Browser-context guard: `sec-fetch-site: cross-site` is always rejected.
 *
 * Origin is the fetch CSRF signal. Caddy on this host rewrites Origin to
 * `http://127.0.0.1:3080` but leaves Referer as `https://<trusted-host>/`;
 * when Origin matches Host we therefore ignore Referer. Referer is only
 * checked when Origin is absent (or as a trusted-host fallback).
 */
export function passesBrowserContextGuard(
	request: IncomingMessage,
	trustedHosts: readonly string[] = [],
): boolean {
	const site = request.headers["sec-fetch-site"];
	if (typeof site === "string" && site.trim().toLowerCase() === "cross-site") return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	const origin = request.headers.origin;
	if (origin !== undefined) {
		if (headerMatchesHost(origin, host) || hostnameInTrustedList(origin, trustedHosts)) return true;
		return false;
	}
	const referer = request.headers.referer;
	if (referer !== undefined) {
		return headerMatchesHost(referer, host) || hostnameInTrustedList(referer, trustedHosts);
	}
	return true;
}

/** CSRF guard for non-GET requests: JSON content-type + the plugin header. */
export function passesCsrfGuard(request: IncomingMessage): boolean {
	const contentType = String(request.headers["content-type"] ?? "").toLowerCase();
	if (!contentType.startsWith("application/json")) return false;
	return request.headers[MANAGEMENT_HEADER] === "1";
}

/** Write a JSON response with the standard hardening headers. */
export function writeJson(response: ServerResponse, status: number, value: unknown): void {
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
	});
	response.end(JSON.stringify(value));
}

/**
 * Read and parse a JSON request body up to `maxBytes`. Returns the parsed value
 * on success, or `undefined` after writing a 413/400 response.
 */
export async function readJsonBody(
	request: IncomingMessage,
	response: ServerResponse,
	maxBytes = MAX_JSON_BODY_BYTES,
): Promise<unknown | undefined> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		let size = 0;
		let settled = false;
		const finish = (value: unknown | undefined): void => {
			if (settled) return;
			settled = true;
			resolve(value);
		};
		request.on("data", (chunk: Buffer | string) => {
			const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
			size += bytes.length;
			if (size > maxBytes) {
				finish(undefined);
				writeJson(response, 413, { ok: false, error: { code: "body-too-large", message: "request body is too large" } });
				request.destroy();
				return;
			}
			chunks.push(bytes);
		});
		request.on("end", () => {
			if (settled) return;
			if (chunks.length === 0) {
				finish({});
				return;
			}
			try {
				finish(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				writeJson(response, 400, { ok: false, error: { code: "invalid-json", message: "request body is not valid JSON" } });
				finish(undefined);
			}
		});
		request.on("error", () => {
			if (settled) return;
			finish(undefined);
			writeJson(response, 400, { ok: false, error: { code: "read-failed", message: "request body could not be read" } });
		});
	});
}
