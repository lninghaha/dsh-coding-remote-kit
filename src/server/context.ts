import type { ExactWebServer } from "./routes.js";

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
	get?(name: string): unknown;
	effect(setup: () => void | (() => void | Promise<void>), label?: string): void;
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
