/**
 * Optional outbound push bridge (ntfy / Bark) for offline approval alerts.
 *
 * Default off. Payloads are redacted (event type + short session id only).
 * Destinations must pass an HTTPS host allowlist and body size cap.
 * Missing config or no paired device → silent no-op.
 */

import { join } from "node:path";
import { z } from "zod";
import { isLoopbackAddress } from "./security.js";
import { readJsonFile, writeFileAtomic } from "./storage.js";
import type { PushEnvelope } from "./upstream.js";

export const MAX_PUSH_BODY_BYTES = 2_048;
export const PUSH_TIMEOUT_MS = 5_000;

/** Public HTTPS hosts allowed as push destinations (SSRF-facing allowlist). */
export const PUSH_ENDPOINT_HOST_ALLOWLIST = Object.freeze([
	"ntfy.sh",
	"ntfy.envs.net",
	"api.day.app",
] as const);

export type PushProvider = "ntfy" | "bark";

export interface PushBridgeConfig {
	readonly enabled: boolean;
	readonly provider: PushProvider;
	readonly endpoint: string;
	readonly credential: string;
}

export interface PublicPushBridgeStatus {
	readonly enabled: boolean;
	readonly provider: PushProvider;
	readonly endpoint: string;
	readonly endpointHost: string | null;
	readonly hasCredential: boolean;
	readonly configured: boolean;
}

export interface PushBridgeLogger {
	warn(message: string): void;
	info(message: string): void;
}

const PushBridgeConfigSchema = z
	.object({
		enabled: z.boolean().default(false),
		provider: z.enum(["ntfy", "bark"]).default("ntfy"),
		endpoint: z.string().default(""),
		credential: z.string().default(""),
	})
	.strict();

const DEFAULT_CONFIG: PushBridgeConfig = Object.freeze({
	enabled: false,
	provider: "ntfy",
	endpoint: "",
	credential: "",
});

export function isAllowedPushHost(hostname: string): boolean {
	const host = hostname.trim().toLowerCase().replace(/\.$/u, "");
	if (host.length === 0) return false;
	if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
	if (isBlockedIpLiteral(host)) return false;
	for (const allowed of PUSH_ENDPOINT_HOST_ALLOWLIST) {
		if (host === allowed) return true;
	}
	// Allow self-hosted ntfy under *.ntfy.sh only (public SaaS subdomain pattern).
	if (host.endsWith(".ntfy.sh") && host !== "ntfy.sh") return true;
	return false;
}

function isBlockedIpLiteral(host: string): boolean {
	if (isLoopbackAddress(host)) return true;
	if (host === "0.0.0.0" || host === "::" || host === "[::]") return true;
	const ipv4 = host.startsWith("::ffff:") ? host.slice(7) : host;
	const parts = ipv4.split(".");
	if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255)) {
		return false;
	}
	const first = Number(parts[0]);
	const second = Number(parts[1]);
	if (first === 10) return true;
	if (first === 127) return true;
	if (first === 169 && second === 254) return true;
	if (first === 172 && second >= 16 && second <= 31) return true;
	if (first === 192 && second === 168) return true;
	if (first === 100 && second >= 64 && second <= 127) return true;
	return false;
}

export type PushUrlCheck =
	| { readonly ok: true; readonly url: URL }
	| { readonly ok: false; readonly reason: string };

/** Validate an outbound push URL against scheme + host allowlist + IP blocks. */
export function assertAllowedPushUrl(raw: string): PushUrlCheck {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return { ok: false, reason: "invalid-url" };
	}
	if (url.protocol !== "https:") return { ok: false, reason: "https-required" };
	if (url.username.length > 0 || url.password.length > 0) {
		return { ok: false, reason: "credentials-in-url-forbidden" };
	}
	if (!isAllowedPushHost(url.hostname)) return { ok: false, reason: "host-not-allowlisted" };
	return { ok: true, url };
}

export function shortSessionId(sessionId: string): string {
	const trimmed = sessionId.trim();
	if (trimmed.length <= 8) return trimmed;
	return trimmed.slice(0, 8);
}

export function buildApprovalDeepLink(
	pageUrl: string,
	sessionId: string,
	approvalId: string,
): string {
	const trimmed = pageUrl.trim().replace(/\/+$/u, "");
	const withPath = /\/m$/u.test(trimmed) ? `${trimmed}/` : trimmed.includes("/m/") ? trimmed : `${trimmed}/m/`;
	const url = new URL(withPath);
	url.searchParams.set("focus", "approval");
	url.searchParams.set("sessionId", sessionId);
	url.searchParams.set("approvalId", approvalId);
	return url.toString();
}

export function buildRedactedApprovalMessage(sessionId: string): {
	readonly title: string;
	readonly body: string;
} {
	const short = shortSessionId(sessionId);
	return {
		title: "DSH approval.requested",
		body: `approval.requested · sess ${short}`,
	};
}

export function parseStoredPushBridgeConfig(raw: unknown): PushBridgeConfig {
	const parsed = PushBridgeConfigSchema.safeParse(raw ?? {});
	if (!parsed.success) return { ...DEFAULT_CONFIG };
	return {
		enabled: parsed.data.enabled,
		provider: parsed.data.provider,
		endpoint: parsed.data.endpoint.trim(),
		credential: parsed.data.credential,
	};
}

export function publicPushBridgeStatus(config: PushBridgeConfig): PublicPushBridgeStatus {
	const endpoint = config.endpoint.trim();
	let endpointHost: string | null = null;
	if (endpoint.length > 0) {
		try {
			endpointHost = new URL(endpoint).hostname;
		} catch {
			endpointHost = null;
		}
	}
	const hasCredential = config.credential.trim().length > 0;
	return {
		enabled: config.enabled,
		provider: config.provider,
		endpoint,
		endpointHost,
		hasCredential,
		configured: config.enabled && endpoint.length > 0 && hasCredential,
	};
}

export interface ValidatePushConfigResult {
	readonly ok: true;
	readonly config: PushBridgeConfig;
}

export interface ValidatePushConfigFailure {
	readonly ok: false;
	readonly reason: string;
}

/** Validate a settings write. Empty credential keeps the previous secret when already set. */
export function validatePushBridgeWrite(
	input: Record<string, unknown>,
	previous: PushBridgeConfig,
): ValidatePushConfigResult | ValidatePushConfigFailure {
	const enabled = input.enabled === true;
	const provider = input.provider === "bark" ? "bark" : input.provider === "ntfy" ? "ntfy" : previous.provider;
	const endpoint = typeof input.endpoint === "string" ? input.endpoint.trim() : previous.endpoint;
	let credential =
		typeof input.credential === "string" ? input.credential : previous.credential;
	if (typeof input.credential === "string" && input.credential.length === 0 && previous.credential.length > 0) {
		credential = previous.credential;
	}
	if (input.clearCredential === true) {
		credential = "";
	}
	if (!enabled) {
		return {
			ok: true,
			config: {
				enabled: false,
				provider,
				endpoint,
				credential,
			},
		};
	}
	if (endpoint.length === 0) return { ok: false, reason: "endpoint-required" };
	if (credential.trim().length === 0) return { ok: false, reason: "credential-required" };
	const checked = assertAllowedPushUrl(endpoint);
	if (!checked.ok) return { ok: false, reason: checked.reason };
	return {
		ok: true,
		config: {
			enabled: true,
			provider,
			endpoint: checked.url.origin + (checked.url.pathname === "/" ? "" : checked.url.pathname.replace(/\/+$/u, "")),
			credential: credential.trim(),
		},
	};
}

export interface PushDeliveryPlan {
	readonly url: string;
	readonly method: "POST" | "GET";
	readonly headers: Record<string, string>;
	readonly body: string | null;
}

export function planApprovalPush(input: {
	readonly config: PushBridgeConfig;
	readonly sessionId: string;
	readonly approvalId: string;
	readonly pageUrl: string;
}): { readonly ok: true; readonly plan: PushDeliveryPlan } | { readonly ok: false; readonly reason: string } {
	const checked = assertAllowedPushUrl(input.config.endpoint);
	if (!checked.ok) return { ok: false, reason: checked.reason };
	const { title, body } = buildRedactedApprovalMessage(input.sessionId);
	const click = buildApprovalDeepLink(input.pageUrl, input.sessionId, input.approvalId);
	if (input.config.provider === "bark") {
		const key = encodeURIComponent(input.config.credential.trim());
		const barkUrl = new URL(
			`${checked.url.origin}${checked.url.pathname.replace(/\/+$/u, "")}/${key}/${encodeURIComponent(title)}/${encodeURIComponent(body)}`,
		);
		barkUrl.searchParams.set("url", click);
		const asString = barkUrl.toString();
		if (utf8ByteLength(asString) > MAX_PUSH_BODY_BYTES) {
			return { ok: false, reason: "body-too-large" };
		}
		const finalCheck = assertAllowedPushUrl(`${barkUrl.origin}/`);
		if (!finalCheck.ok) return { ok: false, reason: finalCheck.reason };
		return {
			ok: true,
			plan: {
				url: asString,
				method: "GET",
				headers: { accept: "application/json" },
				body: null,
			},
		};
	}
	const topic = input.config.credential.trim().replace(/^\/+/u, "");
	const ntfyUrl = `${checked.url.origin}${checked.url.pathname.replace(/\/+$/u, "")}/${encodeURIComponent(topic)}`;
	const ntfyCheck = assertAllowedPushUrl(ntfyUrl);
	if (!ntfyCheck.ok) return { ok: false, reason: ntfyCheck.reason };
	const payload = JSON.stringify({
		topic,
		title,
		message: body,
		click,
		tags: ["warning"],
	});
	if (utf8ByteLength(payload) > MAX_PUSH_BODY_BYTES) {
		return { ok: false, reason: "body-too-large" };
	}
	return {
		ok: true,
		plan: {
			url: ntfyCheck.url.toString(),
			method: "POST",
			headers: {
				"content-type": "application/json; charset=utf-8",
				accept: "application/json",
			},
			body: payload,
		},
	};
}

function utf8ByteLength(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

export interface PushBridgeDeps {
	readonly storageDirectory: string;
	readonly logger: PushBridgeLogger;
	readonly resolvePageUrl: () => string | null;
	readonly hasActiveDevice: () => boolean;
	readonly fetchImpl?: typeof fetch;
	readonly now?: () => number;
}

export class PushBridge {
	readonly #path: string;
	readonly #logger: PushBridgeLogger;
	readonly #resolvePageUrl: () => string | null;
	readonly #hasActiveDevice: () => boolean;
	readonly #fetch: typeof fetch;
	#config: PushBridgeConfig;

	constructor(deps: PushBridgeDeps) {
		this.#path = join(deps.storageDirectory, "push-bridge.json");
		this.#logger = deps.logger;
		this.#resolvePageUrl = deps.resolvePageUrl;
		this.#hasActiveDevice = deps.hasActiveDevice;
		this.#fetch = deps.fetchImpl ?? fetch;
		this.#config = parseStoredPushBridgeConfig(readJsonFile(this.#path));
	}

	get config(): PushBridgeConfig {
		return this.#config;
	}

	status(): PublicPushBridgeStatus {
		return publicPushBridgeStatus(this.#config);
	}

	update(input: Record<string, unknown>): { ok: true; status: PublicPushBridgeStatus } | { ok: false; reason: string } {
		const validated = validatePushBridgeWrite(input, this.#config);
		if (!validated.ok) return validated;
		this.#config = validated.config;
		writeFileAtomic(this.#path, `${JSON.stringify(this.#config, null, "\t")}\n`);
		return { ok: true, status: this.status() };
	}

	/** Fire-and-forget; never throws into the mux loop. */
	notifyApprovalRequested(push: PushEnvelope): void {
		void this.#notifyApprovalRequested(push).catch(() => undefined);
	}

	async #notifyApprovalRequested(push: PushEnvelope): Promise<void> {
		if (push.push !== "approval.requested") return;
		if (!this.#config.enabled) return;
		if (this.#config.endpoint.trim().length === 0 || this.#config.credential.trim().length === 0) return;
		if (!this.#hasActiveDevice()) return;
		const data = asRecord(push.data);
		const sessionId = typeof data?.sessionId === "string" ? data.sessionId : "";
		const approvalId = typeof data?.approvalId === "string" ? data.approvalId : "";
		if (sessionId.length === 0 || approvalId.length === 0) return;
		const pageUrl = this.#resolvePageUrl();
		if (pageUrl === null || pageUrl.length === 0) return;
		const planned = planApprovalPush({
			config: this.#config,
			sessionId,
			approvalId,
			pageUrl,
		});
		if (!planned.ok) {
			this.#logger.warn(`push-bridge skipped (${planned.reason})`);
			return;
		}
		try {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
			try {
				const response = await this.#fetch(planned.plan.url, {
					method: planned.plan.method,
					headers: planned.plan.headers,
					body: planned.plan.body ?? undefined,
					signal: controller.signal,
					redirect: "error",
				});
				if (!response.ok) {
					this.#logger.warn(`push-bridge delivery failed (http ${String(response.status)})`);
				}
			} finally {
				clearTimeout(timer);
			}
		} catch {
			this.#logger.warn("push-bridge delivery failed (network)");
		}
	}
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}
