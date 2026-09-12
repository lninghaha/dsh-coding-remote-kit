import { createRequire } from "node:module";
import type { ExactWebServer } from "./routes.js";
import type { OwnerRequestDiagnostic, OwnerRequestPolicy } from "./security.js";
import { isSessionController, type SessionControllerFace } from "./session-controller-upstream.js";

const require = createRequire(import.meta.url);

const BOM = require("../../compatibility/dsh-bom.json") as {
	readonly coreAbi: string;
	readonly verified: {
		readonly id: string;
		readonly dshVersion: string;
		readonly packages: Readonly<Record<string, string>>;
	};
};
const CORE_ABI = BOM.coreAbi;
const VERIFIED_BOM = Object.freeze(BOM.verified);

export interface MobileRemoteLogger {
	debug(message: string): void;
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

/**
 * Narrow in-process request shape. Matches apiProxy's `{ rpcId, payload }`
 * without importing the host branded `RpcId` type.
 */
export interface HostRpcRequest<P> {
	readonly rpcId: string;
	readonly payload: P;
}

export type HostRpcResult<T> =
	| { readonly ok: true; readonly value: T }
	| {
			readonly ok: false;
			readonly error: { readonly code: string; readonly message: string };
	  };

export interface HostRpcResponse<T> {
	readonly rpcId: string;
	readonly result: HostRpcResult<T>;
}

export interface HostPromptContentPart {
	readonly type: "text";
	readonly text: string;
}

/**
 * Minimal duck-typed face of `ctx.apiProxy`. Do not depend on
 * `@deepseek-ai/dsh-host-apiproxy`; the host injects a structurally
 * compatible object.
 */
export interface HostApiProxy {
	readonly sessions: {
		list(request: HostRpcRequest<{ cursor?: string }>): Promise<HostRpcResponse<{ items: unknown[] }>>;
		history(
			request: HostRpcRequest<{ sessionId: string; beforeSeq?: number; maxMessages?: number }>,
		): Promise<HostRpcResponse<{ events: unknown[]; hasMore: boolean }>>;
		prompt(
			request: HostRpcRequest<{
				sessionId: string;
				mode: "queue" | "steer";
				content: HostPromptContentPart[];
				clientTimeZone?: string;
			}>,
		): Promise<HostRpcResponse<unknown>>;
		cancel(request: HostRpcRequest<{ sessionId: string }>): Promise<HostRpcResponse<unknown>>;
		create?(
			request: HostRpcRequest<{ cwd?: string; workspaceId?: string }>,
		): Promise<HostRpcResponse<{ sessionId: string }>>;
	};
	readonly events: {
		mux(
			request: HostRpcRequest<Record<string, never>>,
			signal: AbortSignal,
		): AsyncIterable<{ readonly rpcId: string; readonly payload: unknown }>;
		host(
			request: HostRpcRequest<Record<string, never>>,
			signal: AbortSignal,
		): AsyncIterable<{ readonly rpcId: string; readonly payload: unknown }>;
	};
	respond(message: {
		readonly type: "client-response";
		readonly rpcId: string;
		readonly result: HostRpcResult<unknown>;
	}): Promise<unknown>;
}

/**
 * Host face consumed by `apply`. `webServer` is the host's loopback-bound HTTP
 * carrier (only `register` is used); `effect` registers cleanup with the
 * plugin fiber. `apiProxy` is the in-process upstream used by M3 RPC.
 */
export interface MobileRemoteHostContext {
	readonly logger: MobileRemoteLogger;
	readonly webServer?: ExactWebServer;
	readonly apiProxy?: HostApiProxy;
	/**
	 * DSH 0.1.5+ Session Remote service. One of `apiProxy` / `sessionController`
	 * must be present for session RPC; older hosts inject the former, newer
	 * hosts expose the latter through the service locator.
	 */
	readonly sessionController?: SessionControllerFace;
	readonly ownerRequestPolicy?: OwnerRequestPolicy;
	get?(name: string): unknown;
	on?(name: string, listener: (...args: never[]) => unknown, options?: unknown): unknown;
	inject?(
		deps: readonly string[],
		callback: (context: MobileRemoteHostContext) => void | (() => void | Promise<void>),
	): unknown;
	effect(setup: () => void | (() => void | Promise<void>), label?: string): void;
}

export interface HostCapability {
	readonly state: "available" | "missing" | "incompatible";
	readonly contract: string;
	readonly reason?: string;
}

export interface HostCompatibilityDiagnostics {
	/** Legacy service summary retained for existing settings clients. */
	readonly apiProxy: { readonly available: boolean; readonly source: "injected" | "lookup" | "missing" };
	/** Legacy service summary retained for existing settings clients. */
	readonly webServer: { readonly available: boolean; readonly source: "injected" | "lookup" | "missing" };
	/** Session Remote backend (DSH 0.1.5+). */
	readonly sessionController: { readonly available: boolean; readonly source: "injected" | "lookup" | "missing" };
	readonly coreAbi: string;
	readonly dshVersion: string | null;
	readonly verifiedBom: typeof VERIFIED_BOM;
	readonly status: "healthy" | "degraded" | "incompatible";
	readonly capabilities: Readonly<
		Record<"apiProxy" | "sessionController" | "webServer" | "ownerRequestPolicy", HostCapability>
	>;
	readonly ownerRequest?: {
		readonly source: "host" | "plugin-fallback";
		readonly diagnostics: readonly OwnerRequestDiagnostic[];
	};
	readonly diagnostics: readonly string[];
	readonly recommendations: readonly string[];
}

export interface HostCompatibilityAdapter {
	readonly apiProxy?: HostApiProxy;
	readonly sessionController?: SessionControllerFace;
	readonly webServer?: ExactWebServer;
	readonly ownerRequestPolicy?: OwnerRequestPolicy;
	readonly diagnostics: HostCompatibilityDiagnostics;
}

export function isHostApiProxy(value: unknown): value is HostApiProxy {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<HostApiProxy>;
	return (
		typeof candidate.sessions?.list === "function" &&
		typeof candidate.sessions.history === "function" &&
		typeof candidate.sessions.prompt === "function" &&
		typeof candidate.sessions.cancel === "function" &&
		typeof candidate.events?.mux === "function" &&
		typeof candidate.events.host === "function" &&
		typeof candidate.respond === "function"
	);
}

function isExactWebServer(value: unknown): value is ExactWebServer {
	return typeof value === "object" && value !== null && typeof (value as Partial<ExactWebServer>).register === "function";
}

function isOwnerRequestPolicy(value: unknown): value is OwnerRequestPolicy {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as Partial<OwnerRequestPolicy>).authorize === "function" &&
		typeof (value as Partial<OwnerRequestPolicy>).diagnostics === "function"
	);
}

function dshVersion(): string | null {
	try {
		const manifest = require("@deepseek-ai/dsh/package.json") as { version?: unknown };
		return typeof manifest.version === "string" ? manifest.version : null;
	} catch {
		return null;
	}
}

function capability(value: unknown, valid: boolean, contract: string): HostCapability {
	if (value === undefined || value === null) return { state: "missing", contract };
	if (!valid) return { state: "incompatible", contract, reason: "service shape does not match the verified contract" };
	return { state: "available", contract };
}

function sourceFor(resolved: unknown, injected: unknown): "injected" | "lookup" | "missing" {
	if (resolved === undefined) return "missing";
	return injected === resolved ? "injected" : "lookup";
}

function lookupService(ctx: MobileRemoteHostContext, name: string): unknown {
	try {
		return ctx.get?.(name);
	} catch {
		return undefined;
	}
}

function injectedService(ctx: MobileRemoteHostContext, name: keyof MobileRemoteHostContext): unknown {
	try {
		return ctx[name];
	} catch {
		return undefined;
	}
}

/**
 * Normalize DSH's injected and service-locator host faces into one stable
 * plugin boundary. The structured result is safe to expose in diagnostics and
 * makes a missing host service observable instead of a late import failure.
 */
export function resolveHostCompatibility(ctx: MobileRemoteHostContext): HostCompatibilityAdapter {
	const injectedApiProxy = injectedService(ctx, "apiProxy");
	const injectedSessionController = injectedService(ctx, "sessionController");
	const injectedWebServer = injectedService(ctx, "webServer");
	const injectedOwnerRequestPolicy = injectedService(ctx, "ownerRequestPolicy");
	// Probe optional services independently: one missing service must not prevent
	// discovery of a later capability during a DSH upgrade or partial unload.
	const lookedUpApiProxy = injectedApiProxy === undefined ? lookupService(ctx, "apiProxy") : undefined;
	const lookedUpSessionController =
		injectedSessionController === undefined ? lookupService(ctx, "sessionController") : undefined;
	const lookedUpWebServer = injectedWebServer === undefined ? lookupService(ctx, "webServer") : undefined;
	const lookedUpOwnerRequestPolicy =
		injectedOwnerRequestPolicy === undefined ? lookupService(ctx, "ownerRequestPolicy") : undefined;
	const apiProxyCandidate = injectedApiProxy ?? lookedUpApiProxy;
	const sessionControllerCandidate = injectedSessionController ?? lookedUpSessionController;
	const webServerCandidate = injectedWebServer ?? lookedUpWebServer;
	const ownerRequestPolicyCandidate = injectedOwnerRequestPolicy ?? lookedUpOwnerRequestPolicy;
	const apiProxy = isHostApiProxy(apiProxyCandidate) ? apiProxyCandidate : undefined;
	const sessionController = isSessionController(sessionControllerCandidate)
		? sessionControllerCandidate
		: undefined;
	const webServer = isExactWebServer(webServerCandidate) ? webServerCandidate : undefined;
	const ownerRequestPolicy = isOwnerRequestPolicy(ownerRequestPolicyCandidate)
		? ownerRequestPolicyCandidate
		: undefined;
	const capabilities = {
		apiProxy: capability(apiProxyCandidate, apiProxy !== undefined, "api-proxy-rpc-v1"),
		sessionController: capability(
			sessionControllerCandidate,
			sessionController !== undefined,
			"api-session-controller-v1",
		),
		webServer: capability(webServerCandidate, webServer !== undefined, "exact-route-v1"),
		ownerRequestPolicy: capability(
			ownerRequestPolicyCandidate,
			ownerRequestPolicy !== undefined,
			"owner-request-policy-v1",
		),
	};
	const sessionBackendAvailable = apiProxy !== undefined || sessionController !== undefined;
	const diagnostics: string[] = [];
	for (const [name, detail] of Object.entries(capabilities)) {
		const optionalMissing =
			(detail.state === "missing" && (name === "apiProxy" || name === "sessionController")) ||
			(name === "ownerRequestPolicy" && detail.state === "missing");
		if (detail.state === "available" || optionalMissing) continue;
		if (name === "webServer") {
			diagnostics.push("webServer: missing (exact-route-v1 requires a host with webServer.register)");
			continue;
		}
		diagnostics.push(`${name}: ${detail.state}${detail.reason === undefined ? "" : ` (${detail.reason})`}`);
	}
	if (!sessionBackendAvailable) {
		diagnostics.push(
			"session backend: missing (neither apiProxy nor sessionController matches the verified contract)",
		);
	}
	const recommendations: string[] = [];
	if (capabilities.webServer.state !== "available") {
		recommendations.push("install a DSH runtime that provides webServer.register before enabling mobile-remote");
	}
	if (!sessionBackendAvailable) {
		recommendations.push(
			"session RPC is unavailable; install a DSH runtime that provides apiProxy (0.1.1) or sessionController (0.1.5+) to use remote session control",
		);
	}
	if (capabilities.ownerRequestPolicy.state === "incompatible") {
		recommendations.push(
			"host owner-request context is unavailable; loopback works and remote Settings requires a complete plugin fallback policy",
		);
	}
	const required = capabilities.webServer;
	const status =
		required.state === "available"
			? diagnostics.length === 0
				? "healthy"
				: "degraded"
			: "incompatible";
	return {
		...(apiProxy === undefined ? {} : { apiProxy }),
		...(sessionController === undefined ? {} : { sessionController }),
		...(webServer === undefined ? {} : { webServer }),
		...(ownerRequestPolicy === undefined ? {} : { ownerRequestPolicy }),
		diagnostics: {
			apiProxy: { available: apiProxy !== undefined, source: sourceFor(apiProxy, injectedApiProxy) },
			webServer: { available: webServer !== undefined, source: sourceFor(webServer, injectedWebServer) },
			sessionController: {
				available: sessionController !== undefined,
				source: sourceFor(sessionController, injectedSessionController),
			},
			coreAbi: CORE_ABI,
			dshVersion: dshVersion(),
			verifiedBom: VERIFIED_BOM,
			status,
			capabilities,
			diagnostics,
			recommendations,
		},
	};
}
