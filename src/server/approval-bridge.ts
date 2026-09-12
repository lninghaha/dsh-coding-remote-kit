/**
 * Live approval / question answerer for the sessionController host.
 *
 * DSH 0.1.5 asks for decisions through two scoped Cordis waterfalls
 * (`approval/request`, `user-questions/request`) whose answerers may delegate
 * with `next()`. This bridge joins that chain only while a phone is actually
 * watching the Session:
 *
 * - no watching phone: behave exactly like before and delegate;
 * - chain answers first (a desktop window is attached and someone decided):
 *   return the chain outcome and the phone card retires through the resolved
 *   push;
 * - the chain has nobody to ask (no browser attached, fail-closed default):
 *   keep waiting for the phone instead of failing closed immediately;
 * - the phone answers first: claim the request with the phone decision.
 *
 * The bridge never fabricates a decision: abandoned asks fail closed through
 * the registry, and the host audit pair still commits inside the same turn.
 */

import { randomUUID } from "node:crypto";
import type { MobileRemoteLogger } from "./context.js";
import type { InteractionRegistry } from "./interactions.js";
import type { UpstreamHub } from "./upstream.js";

export interface InteractionAnswererHost {
	on?(name: string, listener: (...args: never[]) => unknown, options?: unknown): unknown;
}

export interface InteractionAnswererDeps {
	readonly host: InteractionAnswererHost;
	readonly hub: UpstreamHub;
	readonly logger: MobileRemoteLogger;
}

const APPROVAL_OUTCOMES = new Set(["allowed-once", "rejected", "cancelled", "unavailable"]);

/**
 * Register the two answerers. Returns the disposer; a host without `on` (or a
 * hub without an interaction registry) yields a no-op so plugin load never
 * fails on an older host.
 *
 * Registration is prepended: the host's own forwarded-answerer plugin sits
 * earlier in the chain while a browser window is attached and would claim the
 * request before the phone ever sees it. Claiming the head lets the bridge
 * show the card on both surfaces and race them, while a chain that has nobody
 * to ask (no attached browser) still resolves through {@link settleChain}.
 */
export function registerInteractionAnswerers(deps: InteractionAnswererDeps): () => void {
	const on = deps.host.on;
	const interactions = deps.hub.interactions;
	if (typeof on !== "function" || interactions === undefined) return () => undefined;
	const disposers: Array<() => void> = [];
	const lifetime = new AbortController();
	const listen = (name: string, handler: (...args: unknown[]) => unknown): void => {
		try {
			disposers.push(asDisposer(on.call(deps.host, name, handler, { global: true, prepend: true })));
		} catch {
			deps.logger.warn(`mobile-remote: ${name} answerer could not be registered`);
		}
	};
	const watched = (sessionId: string): boolean => deps.hub.hasSessionSubscriber?.(sessionId) === true;

	const answer = (request: unknown, next: unknown, approval: boolean): unknown => {
		const record = asRecord(request);
		const sessionId = sessionIdOfAgent(record?.agent);
		const continuation = next as () => Promise<unknown>;
		if (sessionId === null || !watched(sessionId)) return continuation();
		if (!approval && (!Array.isArray(record?.questions) || record.questions.length === 0)) return continuation();
		return withLifetime(request, lifetime.signal, interactions.signal, approval, continuation, (forward) =>
			(approval ? handleApproval : handleQuestion)(request, forward, interactions, watched, deps.logger),
		);
	};
	listen("approval/request", (request, next) => answer(request, next, true));
	listen("user-questions/request", (request, next) => answer(request, next, false));
	return () => {
		lifetime.abort();
		for (const dispose of disposers.splice(0)) {
			try {
				dispose();
			} catch {
				// Host-owned disposers must not turn plugin teardown into a failure.
			}
		}
	};
}

async function handleApproval(
	request: unknown,
	next: () => Promise<unknown>,
	interactions: InteractionRegistry,
	watched: (sessionId: string) => boolean,
	logger: MobileRemoteLogger,
): Promise<unknown> {
	const record = asRecord(request);
	const sessionId = sessionIdOfAgent(record?.agent);
	if (sessionId === null || !watched(sessionId)) return next();
	const chain = settleChain(next);
	const ask = interactions.askApproval({
		sessionId,
		approvalId: randomUUID(),
		toolName: typeof record?.toolName === "string" && record.toolName.length > 0 ? record.toolName : "tool",
		...(typeof record?.callId === "string" ? { callId: record.callId } : {}),
		...(typeof record?.reason === "string" ? { reason: record.reason } : {}),
		signal: abortSignalOf(record?.signal),
	});
	const first = await Promise.race([
		ask.settled.then((decision) => ({ source: "phone" as const, decision })),
		chain.then((outcome) => ({ source: "chain" as const, outcome })),
	]);
	if (first.source === "phone") {
		if (first.decision !== "withdrawn") return first.decision;
		const result = await chain;
		if (result.kind === "error") throw result.error;
		return result.value === undefined || result.value === "unavailable" ? "cancelled" : result.value;
	}
	const outcome = first.outcome;
	if (outcome.kind === "error") {
		ask.abandon();
		throw outcome.error;
	}
	if (typeof outcome.value === "string" && APPROVAL_OUTCOMES.has(outcome.value) && outcome.value !== "unavailable") {
		ask.abandon();
		return outcome.value;
	}
	// Nobody was available to answer through the composed chain; the phone is
	// the only interactive answerer this deployment has right now.
	logger.debug("mobile-remote: approval delegated by the host chain; awaiting the phone");
	const decision = await ask.settled;
	return decision === "withdrawn" ? "cancelled" : decision;
}

async function handleQuestion(
	request: unknown,
	next: () => Promise<unknown>,
	interactions: InteractionRegistry,
	watched: (sessionId: string) => boolean,
	logger: MobileRemoteLogger,
): Promise<unknown> {
	const record = asRecord(request);
	const sessionId = sessionIdOfAgent(record?.agent);
	const questions = Array.isArray(record?.questions) ? record.questions : [];
	if (sessionId === null || questions.length === 0 || !watched(sessionId)) return next();
	const chain = settleChain(next);
	const ask = interactions.askQuestion({ sessionId, questions, signal: abortSignalOf(record?.signal) });
	const first = await Promise.race([
		ask.settled.then((answer) => ({ source: "phone" as const, answer })),
		chain.then((answer) => ({ source: "chain" as const, answer })),
	]);
	if (first.source === "phone") {
		if (first.answer !== "withdrawn") return first.answer;
		const result = await chain;
		if (result.kind === "error") throw result.error;
		if (result.value !== undefined && result.value !== null) return result.value;
		throw new Error("mobile-remote: no answerer remains for the question");
	}
	if (first.answer.kind === "error") {
		ask.abandon();
		throw first.answer.error;
	}
	if (first.answer.value !== undefined && first.answer.value !== null) {
		ask.abandon();
		return first.answer.value;
	}
	logger.debug("mobile-remote: question delegated by the host chain; awaiting the phone");
	const answer = await ask.settled;
	if (answer === "withdrawn") throw new Error("mobile-remote: no answerer remains for the question");
	return answer;
}

/**
 * 只有宿主明确的 NO_PROVIDER 才表示无人应答，其他异常保留原意。
 */
function settleChain(
	next: () => Promise<unknown>,
): Promise<{ kind: "value"; value: unknown } | { kind: "error"; error: unknown }> {
	return Promise.resolve()
		.then(() => next())
		.then(
			(value) => ({ kind: "value" as const, value }),
			(error) =>
				asRecord(error)?.code === "NO_PROVIDER"
					? { kind: "value" as const, value: undefined }
					: { kind: "error" as const, error },
		);
}

async function withLifetime(
	request: unknown,
	lifetime: AbortSignal,
	registry: AbortSignal,
	approval: boolean,
	next: () => Promise<unknown>,
	work: (forward: () => Promise<unknown>) => Promise<unknown>,
): Promise<unknown> {
	const requestSignal = abortSignalOf(asRecord(request)?.signal);
	const completed = new AbortController();
	const signal = AbortSignal.any([completed.signal, lifetime, registry, ...(requestSignal ? [requestSignal] : [])]);
	const record = asRecord(request);
	const originalSignal = record === null ? undefined : Object.getOwnPropertyDescriptor(record, "signal");
	let forwarded: Promise<unknown> | undefined;
	let onAbort = () => {};
	try {
		// Cordis next() 不接受替代参数。给同一请求借用一个子生命周期，
		// 让手机先答后能撤回已经转发到桌面的卡片，不取消原始宿主 signal。
		if (record !== null) record.signal = signal;
		const cancelled = new Promise<unknown>((resolve, reject) => {
			onAbort = () => (approval ? resolve("cancelled") : reject(new Error("mobile-remote: question cancelled")));
			if (signal.aborted) onAbort();
			else signal.addEventListener("abort", onAbort, { once: true });
		});
		if (signal.aborted) return await cancelled;
		return await Promise.race([
			work(() => {
				forwarded = Promise.resolve().then(next);
				return forwarded;
			}),
			cancelled,
		]);
	} finally {
		signal.removeEventListener("abort", onAbort);
		completed.abort();
		const restore = () => {
			if (record?.signal !== signal) return;
			if (originalSignal === undefined) delete record.signal;
			else Object.defineProperty(record, "signal", originalSignal);
		};
		// 转发队列可能尚未序列化请求，不能提前还原为未取消的原 signal。
		if (forwarded === undefined) restore();
		else void forwarded.then(restore, restore);
	}
}

function sessionIdOfAgent(agent: unknown): string | null {
	const record = asRecord(agent);
	return typeof record?.id === "string" && record.id.length > 0 ? record.id : null;
}

function abortSignalOf(value: unknown): AbortSignal | undefined {
	return value instanceof AbortSignal ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function asDisposer(value: unknown): () => void {
	if (typeof value === "function") return value as () => void;
	if (typeof value === "object" && value !== null) {
		const dispose = (value as { dispose?: unknown }).dispose;
		if (typeof dispose === "function") {
			return () => {
				dispose.call(value);
			};
		}
	}
	return () => undefined;
}
