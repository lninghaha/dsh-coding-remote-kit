/**
 * Mobile RPC envelope and the method allowlist.
 *
 * Envelope: request `{id, method, params?}` → success `{id, ok:true, result}` or
 * failure `{id, ok:false, error:{code,message}}`. Methods outside the allowlist
 * are answered `forbidden` before any upstream call.
 */

import { MOBILE_RPC_METHOD_ALLOWLIST } from "../shared/constants.js";
import { statusGetResult } from "../shared/handshake.js";
import type { AuditLogger } from "./registry.js";
import type { RespondInput, UpstreamHub } from "./upstream.js";

export function isMethodAllowed(method: string): boolean {
	return (MOBILE_RPC_METHOD_ALLOWLIST as readonly string[]).includes(method);
}

export interface RpcError {
	readonly code: string;
	readonly message: string;
}

export interface RpcConnection {
	subscribeSession(sessionId: string): void;
	unsubscribeSession(sessionId: string): void;
	subscribeHost(): void;
}

export interface RpcDispatchContext {
	readonly upstream?: UpstreamHub;
	readonly deviceId?: string;
	readonly audit?: Pick<AuditLogger, "log">;
	readonly connection?: RpcConnection;
}

function error(id: string | number | null, code: string, message: string): Record<string, unknown> {
	return { id, ok: false, error: { code, message } };
}

function ok(id: string | number, result: unknown): Record<string, unknown> {
	return { id, ok: true, result };
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function readSessionId(params: Record<string, unknown> | null): string | null {
	const sessionId = params?.sessionId;
	return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
}

function auditWrite(ctx: RpcDispatchContext, method: string, sessionId: string): void {
	if (ctx.audit === undefined || ctx.deviceId === undefined) return;
	ctx.audit.log({ event: "rpc_write", deviceId: ctx.deviceId, detail: { method, sessionId } });
}

function foldUpstream(id: string | number, folded: { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }): Record<string, unknown> {
	if (folded.ok) return ok(id, folded.value);
	const message = folded.error.message.length > 0 ? folded.error.message : folded.error.code;
	return error(id, "upstream_error", message);
}

/** Dispatch one decoded RPC request to a wire-ready response. */
export async function dispatchRpc(message: unknown, ctx: RpcDispatchContext = {}): Promise<Record<string, unknown>> {
	if (typeof message !== "object" || message === null || Array.isArray(message)) {
		return error(null, "invalid_params", "request must be an object");
	}
	const record = message as Record<string, unknown>;
	const id = record.id;
	if (typeof id !== "string" && typeof id !== "number") {
		return error(null, "invalid_params", "request id must be a string or number");
	}
	const method = record.method;
	if (typeof method !== "string" || method.length === 0) {
		return error(id, "invalid_params", "method must be a non-empty string");
	}
	if (record.params !== undefined && (typeof record.params !== "object" || record.params === null)) {
		return error(id, "invalid_params", "params must be an object");
	}
	if (!isMethodAllowed(method)) {
		return error(id, "forbidden", `method "${method}" is not allowed on the mobile data plane`);
	}
	const params = record.params === undefined ? {} : asRecord(record.params);
	if (record.params !== undefined && params === null) {
		return error(id, "invalid_params", "params must be an object");
	}
	return dispatchAllowed(id, method, params ?? {}, ctx);
}

async function dispatchAllowed(
	id: string | number,
	method: string,
	params: Record<string, unknown>,
	ctx: RpcDispatchContext,
): Promise<Record<string, unknown>> {
	switch (method) {
		case "status.get":
			return ok(id, statusGetResult());
		case "session.list": {
			if (ctx.upstream === undefined) return error(id, "upstream_error", "apiProxy is unavailable");
			return foldUpstream(id, await ctx.upstream.list());
		}
		case "session.history": {
			const sessionId = readSessionId(params);
			if (sessionId === null) return error(id, "invalid_params", "sessionId is required");
			if (ctx.upstream === undefined) return error(id, "upstream_error", "apiProxy is unavailable");
			const beforeSeq = typeof params.beforeSeq === "number" ? params.beforeSeq : undefined;
			const maxMessages = typeof params.maxMessages === "number" ? params.maxMessages : undefined;
			return foldUpstream(
				id,
				await ctx.upstream.history({
					sessionId,
					...(beforeSeq === undefined ? {} : { beforeSeq }),
					...(maxMessages === undefined ? {} : { maxMessages }),
				}),
			);
		}
		case "session.subscribe": {
			const sessionId = readSessionId(params);
			if (sessionId === null) return error(id, "invalid_params", "sessionId is required");
			ctx.connection?.subscribeSession(sessionId);
			return ok(id, { accepted: true });
		}
		case "session.unsubscribe": {
			const sessionId = readSessionId(params);
			if (sessionId === null) return error(id, "invalid_params", "sessionId is required");
			ctx.connection?.unsubscribeSession(sessionId);
			return ok(id, { accepted: true });
		}
		case "host.subscribe":
			ctx.connection?.subscribeHost();
			return ok(id, { accepted: true });
		case "session.prompt": {
			const sessionId = readSessionId(params);
			if (sessionId === null) return error(id, "invalid_params", "sessionId is required");
			const text = typeof params.text === "string" ? params.text : "";
			if (text.trim().length === 0) return error(id, "invalid_params", "text must be a non-empty string");
			if (ctx.upstream === undefined) return error(id, "upstream_error", "apiProxy is unavailable");
			const mode = params.mode === "steer" ? "steer" : "queue";
			auditWrite(ctx, method, sessionId);
			return foldUpstream(id, await ctx.upstream.prompt({ sessionId, mode, text }));
		}
		case "session.cancel": {
			const sessionId = readSessionId(params);
			if (sessionId === null) return error(id, "invalid_params", "sessionId is required");
			if (ctx.upstream === undefined) return error(id, "upstream_error", "apiProxy is unavailable");
			auditWrite(ctx, method, sessionId);
			return foldUpstream(id, await ctx.upstream.cancel(sessionId));
		}
		case "respond":
			return dispatchRespond(id, params, ctx);
		default:
			return error(id, "unknown_method", `method "${method}" is not implemented`);
	}
}

function parseRespond(params: Record<string, unknown>): RespondInput | { error: string } {
	const rpcId = params.rpcId;
	const sessionId = params.sessionId;
	if (typeof rpcId !== "string" || rpcId.length === 0) return { error: "rpcId is required" };
	if (typeof sessionId !== "string" || sessionId.length === 0) return { error: "sessionId is required" };
	const outcome = params.outcome;
	const approvalId = params.approvalId;
	if (outcome === "allowed-once" || outcome === "rejected") {
		if (typeof approvalId !== "string" || approvalId.length === 0) return { error: "approvalId is required" };
		return { kind: "approval", rpcId, sessionId, approvalId, outcome };
	}
	if (Array.isArray(params.answers)) {
		const answers: Array<{ id: string; selected: unknown; custom?: string }> = [];
		for (const item of params.answers) {
			const record = asRecord(item);
			if (record === null || typeof record.id !== "string") return { error: "answers must include id" };
			const answer: { id: string; selected: unknown; custom?: string } = {
				id: record.id,
				selected: record.selected,
			};
			if (typeof record.custom === "string") answer.custom = record.custom;
			answers.push(answer);
		}
		return { kind: "question", rpcId, sessionId, answers };
	}
	return { error: "respond requires an approval outcome or question answers" };
}

async function dispatchRespond(
	id: string | number,
	params: Record<string, unknown>,
	ctx: RpcDispatchContext,
): Promise<Record<string, unknown>> {
	const parsed = parseRespond(params);
	if ("error" in parsed) return error(id, "invalid_params", parsed.error);
	if (ctx.upstream === undefined) return error(id, "upstream_error", "apiProxy is unavailable");
	auditWrite(ctx, "respond", parsed.sessionId);
	return foldUpstream(id, await ctx.upstream.respond(parsed));
}
