/**
 * Management-plane guard chain (mounted on the host `webServer`).
 *
 * Every management route must pass an OwnerRequestPolicy. Local/SSH access
 * requires a loopback peer and matching loopback Host/Origin. Trusted HTTPS
 * proxy access additionally requires an exact peer, exact Origin/Host,
 * same-origin Fetch Metadata, proxy-injected owner proof, and independent
 * mutation CSRF proof. Non-GET requests also require JSON plus the public
 * plugin marker as a defense-in-depth signal.
 * and the JSON body is capped at 64KiB                    (→ 413).
 *
 * All responses carry `cache-control: no-store` and `x-content-type-options:
 * nosniff`.
 */

import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export const MAX_JSON_BODY_BYTES = 64 * 1024;
export const MANAGEMENT_HEADER = "x-dsh-mobile-remote";
export const OWNER_PROOF_HEADER = "x-dsh-owner-proof";
export const OWNER_CSRF_HEADER = "x-dsh-csrf-token";

export type OwnerAccessMode = "loopback" | "ssh-tunnel" | "trusted-https-proxy";

export type OwnerRequestDecision =
	| { readonly authorized: true; readonly accessMode: OwnerAccessMode }
	| { readonly authorized: false; readonly reason: string };

export interface OwnerRequestDiagnostic {
	readonly id: string;
	readonly level: "info" | "error";
	readonly message: string;
}

export interface OwnerRequestPolicy {
	authorize(request: IncomingMessage): OwnerRequestDecision;
	diagnostics(): readonly OwnerRequestDiagnostic[];
}

export interface TrustedReverseProxyPolicyConfig {
	/** Exact TCP peers allowed to inject owner-only headers. Forwarded peers never count. */
	readonly peers?: readonly string[];
	/** Exact HTTPS browser origins allowed through the trusted proxy. */
	readonly origins?: readonly string[];
	/** Secret injected by the trusted proxy only after owner authentication. */
	readonly ownerProof?: string;
	/** Independent CSRF secret injected by the trusted proxy for mutation requests. */
	readonly csrfToken?: string;
}

export interface OwnerRequestPolicyConfig {
	/** Use when loopback is intentionally reached through an SSH port forward. */
	readonly loopbackAccessMode?: "loopback" | "ssh-tunnel";
	readonly trustedProxy?: TrustedReverseProxyPolicyConfig;
}

const OWNER_ACCESS_MODES = new Set<OwnerAccessMode>(["loopback", "ssh-tunnel", "trusted-https-proxy"]);

/** Keep a changing host policy from throwing through the plugin route tree. */
export function safeguardOwnerRequestPolicy(policy: OwnerRequestPolicy): OwnerRequestPolicy {
	return Object.freeze({
		authorize(request: IncomingMessage): OwnerRequestDecision {
			try {
				const decision = policy.authorize(request);
				if (decision?.authorized === false) {
					return { authorized: false, reason: typeof decision.reason === "string" ? decision.reason : "denied" };
				}
				if (decision?.authorized === true && OWNER_ACCESS_MODES.has(decision.accessMode)) {
					return { authorized: true, accessMode: decision.accessMode };
				}
				return { authorized: false, reason: "invalid-owner-policy-decision" };
			} catch {
				return { authorized: false, reason: "owner-policy-error" };
			}
		},
		diagnostics(): readonly OwnerRequestDiagnostic[] {
			try {
				const diagnostics = policy.diagnostics();
				if (!Array.isArray(diagnostics) || !diagnostics.every(isOwnerRequestDiagnostic)) {
					return [ownerPolicyDiagnosticError("owner request policy returned invalid diagnostics")];
				}
				return Object.freeze([...diagnostics]);
			} catch {
				return [ownerPolicyDiagnosticError("owner request policy diagnostics failed")];
			}
		},
	});
}

function isOwnerRequestDiagnostic(value: unknown): value is OwnerRequestDiagnostic {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<OwnerRequestDiagnostic>;
	return (
		typeof candidate.id === "string" &&
		(candidate.level === "info" || candidate.level === "error") &&
		typeof candidate.message === "string"
	);
}

function ownerPolicyDiagnosticError(message: string): OwnerRequestDiagnostic {
	return { id: "owner-request.host-policy-invalid", level: "error", message };
}

interface TrustedProxyPolicy {
	readonly peers: ReadonlySet<string>;
	readonly origins: ReadonlySet<string>;
	readonly ownerProof: string;
	readonly csrfToken: string;
}

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

/**
 * Build an immutable owner-request policy. A partially configured reverse
 * proxy is deliberately unusable: a trusted Host by itself is not proof that
 * the caller is the DSH owner.
 */
export function createOwnerRequestPolicy(config: OwnerRequestPolicyConfig = {}): OwnerRequestPolicy {
	const loopbackAccessMode = config.loopbackAccessMode ?? "loopback";
	const proxyConfigured = config.trustedProxy !== undefined;
	const trustedProxy = parseTrustedProxyPolicy(config.trustedProxy);
	const diagnostics: OwnerRequestDiagnostic[] = [
		{
			id: "owner-request.loopback",
			level: "info",
			message: "loopback owner requests require a loopback TCP peer and matching loopback Host/origin",
		},
	];
	if (proxyConfigured && trustedProxy === undefined) {
		diagnostics.push({
			id: "owner-request.trusted-proxy-incomplete",
			level: "error",
			message:
				"trusted reverse proxy access is disabled because peers, origins, ownerProof, and csrfToken are not all valid",
		});
	} else if (trustedProxy !== undefined) {
		diagnostics.push({
			id: "owner-request.trusted-proxy",
			level: "info",
			message: "trusted reverse proxy access requires peer, exact HTTPS origin, owner proof, Fetch Metadata, and CSRF proof",
		});
	}
	const frozenDiagnostics = Object.freeze([...diagnostics]);

	return Object.freeze({
		authorize(request: IncomingMessage): OwnerRequestDecision {
			const peer = normalizePeer(request.socket.remoteAddress);
			// A configured proxy peer is always treated as proxy traffic. This is
			// required for same-host reverse proxies: accepting their loopback TCP
			// connection first would let a rewritten Host bypass owner proof.
			if (trustedProxy !== undefined && peer !== undefined && trustedProxy.peers.has(peer)) {
				return authorizeTrustedProxyRequest(request, trustedProxy);
			}
			const local = authorizeLoopbackOwnerRequest(request, loopbackAccessMode);
			if (local.authorized) return local;
			if (trustedProxy === undefined) {
				return proxyConfigured ? { authorized: false, reason: "incomplete-policy" } : local;
			}
			return authorizeTrustedProxyRequest(request, trustedProxy);
		},
		diagnostics: () => frozenDiagnostics,
	});
}

export const LOOPBACK_OWNER_REQUEST_POLICY = createOwnerRequestPolicy();

function authorizeLoopbackOwnerRequest(
	request: IncomingMessage,
	accessMode: "loopback" | "ssh-tunnel",
): OwnerRequestDecision {
	if (!isLoopbackAddress(request.socket.remoteAddress)) return { authorized: false, reason: "peer" };
	if (singleHeader(request, "sec-fetch-site") === "cross-site") {
		return { authorized: false, reason: "fetch-metadata" };
	}
	const hostHeader = singleHeader(request, "host");
	const host = hostNameOf(hostHeader);
	if (hostHeader === undefined || host === null || (host !== "localhost" && !isLoopbackAddress(host))) {
		return { authorized: false, reason: "host" };
	}
	const origin = singleHeader(request, "origin");
	if (origin !== undefined && !headerMatchesHost(origin, hostHeader)) {
		return { authorized: false, reason: "origin" };
	}
	return { authorized: true, accessMode };
}

function authorizeTrustedProxyRequest(
	request: IncomingMessage,
	policy: TrustedProxyPolicy,
): OwnerRequestDecision {
	const peer = normalizePeer(request.socket.remoteAddress);
	if (peer === undefined || !policy.peers.has(peer)) return { authorized: false, reason: "peer" };
	const origin = normalizeHttpsOrigin(singleHeader(request, "origin"));
	if (origin === undefined || !policy.origins.has(origin)) return { authorized: false, reason: "origin" };
	const host = normalizeAuthority(singleHeader(request, "host"));
	if (host === undefined || host !== new URL(origin).host.toLowerCase()) {
		return { authorized: false, reason: "host" };
	}
	// Missing Fetch Metadata is rejected on the remote path.
	if (singleHeader(request, "sec-fetch-site") !== "same-origin") {
		return { authorized: false, reason: "fetch-metadata" };
	}
	if (!secretMatches(singleHeader(request, OWNER_PROOF_HEADER), policy.ownerProof)) {
		return { authorized: false, reason: "owner-proof" };
	}
	if (isMutation(request.method) && !secretMatches(singleHeader(request, OWNER_CSRF_HEADER), policy.csrfToken)) {
		return { authorized: false, reason: "csrf" };
	}
	return { authorized: true, accessMode: "trusted-https-proxy" };
}

function parseTrustedProxyPolicy(
	config: TrustedReverseProxyPolicyConfig | undefined,
): TrustedProxyPolicy | undefined {
	if (config === undefined) return undefined;
	const peers = new Set(
		(config.peers ?? []).map(normalizePeer).filter((value): value is string => value !== undefined),
	);
	const origins = new Set(
		(config.origins ?? []).map(normalizeHttpsOrigin).filter((value): value is string => value !== undefined),
	);
	if (peers.size === 0 || origins.size === 0) return undefined;
	if (!nonEmptySecret(config.ownerProof) || !nonEmptySecret(config.csrfToken)) return undefined;
	if (config.ownerProof === config.csrfToken) return undefined;
	return { peers, origins, ownerProof: config.ownerProof, csrfToken: config.csrfToken };
}

function singleHeader(request: IncomingMessage, name: string): string | undefined {
	const value = request.headers[name];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function nonEmptySecret(value: string | undefined): value is string {
	return typeof value === "string" && value.length > 0;
}

function secretMatches(received: string | undefined, expected: string): boolean {
	if (received === undefined) return false;
	const actualBytes = Buffer.from(received);
	const expectedBytes = Buffer.from(expected);
	return actualBytes.byteLength === expectedBytes.byteLength && timingSafeEqual(actualBytes, expectedBytes);
}

function normalizeHttpsOrigin(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	try {
		const parsed = new URL(value);
		if (parsed.protocol !== "https:") return undefined;
		if (
			parsed.username !== "" ||
			parsed.password !== "" ||
			parsed.pathname !== "/" ||
			parsed.search !== "" ||
			parsed.hash !== ""
		) {
			return undefined;
		}
		return parsed.origin.toLowerCase();
	} catch {
		return undefined;
	}
}

function normalizeAuthority(value: string | undefined): string | undefined {
	if (value === undefined || value.includes("/") || value.includes("@")) return undefined;
	try {
		return new URL(`https://${value}`).host.toLowerCase();
	} catch {
		return undefined;
	}
}

function normalizePeer(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	if (normalized.length === 0) return undefined;
	return normalized.startsWith("::ffff:") ? normalized.slice("::ffff:".length) : normalized;
}

function isMutation(method: string | undefined): boolean {
	return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
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
 * Backward-compatible local predicate. `trustedHosts` is intentionally
 * ignored: a Host allowlist is routing metadata, not owner authentication.
 */
export function isTrustedManagementRequest(
	request: IncomingMessage,
	_trustedHosts: readonly string[] = [],
): boolean {
	if (!isLoopbackAddress(request.socket.remoteAddress)) return false;
	const host = hostNameOf(request.headers.host);
	if (host === null) return false;
	return host === "localhost" || isLoopbackAddress(host);
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

/**
 * Backward-compatible browser-context helper. Trusted host lists are ignored;
 * remote owner authorization must go through `OwnerRequestPolicy`.
 */
export function passesBrowserContextGuard(
	request: IncomingMessage,
	_trustedHosts: readonly string[] = [],
): boolean {
	const site = request.headers["sec-fetch-site"];
	if (typeof site === "string" && site.trim().toLowerCase() === "cross-site") return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	const origin = request.headers.origin;
	if (origin !== undefined) {
		return headerMatchesHost(origin, host);
	}
	const referer = request.headers.referer;
	if (referer !== undefined) {
		return headerMatchesHost(referer, host);
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
