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
	const listen = (name: string, handler: (...args: unknown[]) => unknown): void => {
		try {
			disposers.push(asDisposer(on.call(deps.host, name, handler, { global: true, prepend: true })));
		} catch {
			deps.logger.warn(`mobile-remote: ${name} answerer could not be registered`);
		}
	};
	const watched = (sessionId: string): boolean => deps.hub.hasSessionSubscriber?.(sessionId) === true;

	listen("approval/request", (request, next) =>
		handleApproval(request, next as () => Promise<unknown>, interactions, watched, deps.logger),
	);
	listen("user-questions/request", (request, next) =>
		handleQuestion(request, next as () => Promise<unknown>, interactions, watched, deps.logger),
	);
	return () => {
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
	if (first.source === "phone") return first.decision;
	const outcome = first.outcome;
	if (typeof outcome === "string" && APPROVAL_OUTCOMES.has(outcome) && outcome !== "unavailable") {
		ask.abandon();
		return outcome;
	}
	// Nobody was available to answer through the composed chain; the phone is
	// the only interactive answerer this deployment has right now.
	logger.debug("mobile-remote: approval delegated by the host chain; awaiting the phone");
	return ask.settled;
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
	if (first.source === "phone") return first.answer;
	if (first.answer !== undefined && first.answer !== null) {
		ask.abandon();
		return first.answer;
	}
	logger.debug("mobile-remote: question delegated by the host chain; awaiting the phone");
	return ask.settled;
}

/**
 * Normalize one chain continuation: a rejection means the composed answerers
 * had nobody to ask, which the caller treats as "keep waiting for the phone".
 */
function settleChain(next: () => Promise<unknown>): Promise<unknown> {
	return Promise.resolve()
		.then(() => next())
		.catch(() => undefined);
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
