/**
 * Pending approval / question interactions for the sessionController host.
 *
 * DSH 0.1.5 delivers approvals and user questions as scoped Cordis waterfalls
 * (`approval/request`, `user-questions/request`) instead of mux frames, so the
 * plugin answers them itself. One registry entry mirrors one unanswered
 * request: the phone receives the same `approval.requested` /
 * `question.requested` push as before, carrying this registry's `rpcId`, and
 * answers through the existing `respond` RPC. Settlement always broadcasts the
 * matching `*.resolved` push so every subscriber retires the card, and replay
 * re-sends still-pending cards to a subscriber that just (re)connected.
 */

import { randomUUID } from "node:crypto";
import type { PushEnvelope, RespondInput } from "./upstream.js";

export type ApprovalDecision = "allowed-once" | "rejected" | "cancelled" | "unavailable";

export interface ApprovalAsk {
	readonly sessionId: string;
	readonly approvalId: string;
	readonly toolName: string;
	readonly callId?: string;
	readonly reason?: string;
	readonly signal?: AbortSignal | undefined;
}

export interface QuestionAsk {
	readonly sessionId: string;
	readonly questions: readonly unknown[];
	readonly signal?: AbortSignal | undefined;
}

export interface QuestionAnswerItem {
	readonly id: string;
	readonly selected: readonly string[];
	readonly custom?: string;
}

export interface QuestionAnswer {
	readonly answers: readonly QuestionAnswerItem[];
}

/** One in-flight approval ask: the card identity plus its settlement. */
export interface ApprovalHandle {
	readonly rpcId: string;
	readonly settled: Promise<ApprovalDecision>;
	/** Retire the phone card because another answerer already decided. */
	abandon(): void;
}

export interface QuestionHandle {
	readonly rpcId: string;
	readonly settled: Promise<QuestionAnswer>;
	/** Retire the phone card because another answerer already answered. */
	abandon(): void;
}

export interface InteractionRegistryOptions {
	/** Broadcast one push for one session to every subscribed phone. */
	readonly emit: (sessionId: string, push: PushEnvelope) => void;
}

type PendingOutcome =
	| { readonly kind: "approval"; readonly decision: ApprovalDecision }
	| { readonly kind: "question"; readonly answers: readonly QuestionAnswerItem[] }
	| { readonly kind: "aborted" };

interface PendingEntry {
	readonly rpcId: string;
	readonly sessionId: string;
	readonly kind: "approval" | "question";
	readonly approvalId: string;
	readonly request: PushEnvelope;
	readonly settled: Promise<PendingOutcome>;
	readonly settle: (outcome: PendingOutcome) => void;
}

/**
 * One shared registry: the approval bridge asks, the phone answers, and the
 * data plane replays the still-open cards after a disconnect. Entries are
 * keyed by the phone-visible `rpcId`; nothing here stores prompt text.
 */
export class InteractionRegistry {
	readonly #entries = new Map<string, PendingEntry>();
	readonly #emit: (sessionId: string, push: PushEnvelope) => void;

	constructor(options: InteractionRegistryOptions) {
		this.#emit = options.emit;
	}

	get size(): number {
		return this.#entries.size;
	}

	hasPending(sessionId: string): boolean {
		for (const entry of this.#entries.values()) {
			if (entry.sessionId === sessionId) return true;
		}
		return false;
	}

	/** Ask the phone to decide one approval; the handle settles with the outcome. */
	askApproval(ask: ApprovalAsk): ApprovalHandle {
		const entry = this.#register({
			sessionId: ask.sessionId,
			kind: "approval",
			approvalId: ask.approvalId,
			signal: ask.signal,
			request: (rpcId) => ({
				push: "approval.requested",
				rpcId,
				data: {
					sessionId: ask.sessionId,
					approvalId: ask.approvalId,
					toolName: ask.toolName,
					...(ask.callId === undefined ? {} : { callId: ask.callId }),
					...(ask.reason === undefined ? {} : { reason: ask.reason }),
				},
			}),
		});
		if (entry === null) {
			return { rpcId: "", settled: Promise.resolve("cancelled"), abandon: () => undefined };
		}
		return {
			rpcId: entry.rpcId,
			settled: entry.settled.then((outcome) => (outcome.kind === "approval" ? outcome.decision : "cancelled")),
			abandon: () => {
				entry.settle({ kind: "aborted" });
			},
		};
	}

	/** Ask the phone one structured question set; the handle settles with its answer. */
	askQuestion(ask: QuestionAsk): QuestionHandle {
		const entry = this.#register({
			sessionId: ask.sessionId,
			kind: "question",
			approvalId: "",
			signal: ask.signal,
			request: (rpcId) => ({
				push: "question.requested",
				rpcId,
				data: { sessionId: ask.sessionId, questions: ask.questions },
			}),
		});
		if (entry === null) {
			return {
				rpcId: "",
				settled: Promise.reject(new Error("mobile-remote: the question was cancelled before it reached the phone")),
				abandon: () => undefined,
			};
		}
		return {
			rpcId: entry.rpcId,
			settled: entry.settled.then((outcome) => {
				if (outcome.kind === "question") return { answers: outcome.answers };
				throw new Error("mobile-remote: the phone did not answer the question");
			}),
			abandon: () => {
				entry.settle({ kind: "aborted" });
			},
		};
	}

	/**
	 * Complete one pending entry from a `respond` RPC. Returns false when the
	 * rpcId is unknown or the response kind / approval identity does not match,
	 * so the caller can answer `not-pending` instead of silently dropping it.
	 */
	complete(input: RespondInput): boolean {
		const entry = this.#entries.get(input.rpcId);
		if (entry === undefined || entry.sessionId !== input.sessionId) return false;
		if (input.kind === "approval") {
			if (entry.kind !== "approval" || entry.approvalId !== input.approvalId) return false;
			this.#settle(entry, { kind: "approval", decision: input.outcome });
			return true;
		}
		if (entry.kind !== "question") return false;
		this.#settle(entry, { kind: "question", answers: normalizeAnswers(input.answers) });
		return true;
	}

	/** Re-send every still-pending card for one session to a fresh subscriber. */
	replay(sessionId: string, send: (push: PushEnvelope) => void): void {
		for (const entry of this.#entries.values()) {
			if (entry.sessionId === sessionId) send(entry.request);
		}
	}

	/**
	 * Fail every pending card of one Session after its last phone subscriber
	 * left (a temporary disconnect is absorbed by the caller's grace window).
	 */
	settleSession(sessionId: string, decision: ApprovalDecision = "cancelled"): void {
		for (const entry of [...this.#entries.values()]) {
			if (entry.sessionId !== sessionId) continue;
			this.#settle(entry, entry.kind === "approval" ? { kind: "approval", decision } : { kind: "aborted" });
		}
	}

	/** Fail every pending entry closed (plugin unload, host iteration death). */
	stop(): void {
		for (const entry of [...this.#entries.values()]) {
			this.#settle(entry, { kind: "aborted" });
		}
	}

	#register(input: {
		readonly sessionId: string;
		readonly kind: "approval" | "question";
		readonly approvalId: string;
		readonly request: (rpcId: string) => PushEnvelope;
		readonly signal: AbortSignal | undefined;
	}): PendingEntry | null {
		if (input.signal?.aborted === true) return null;
		const rpcId = randomUUID();
		const request = input.request(rpcId);
		let resolveSettled: (outcome: PendingOutcome) => void = () => undefined;
		const settled = new Promise<PendingOutcome>((resolve) => {
			resolveSettled = resolve;
		});
		const entry: PendingEntry = {
			rpcId,
			sessionId: input.sessionId,
			kind: input.kind,
			approvalId: input.approvalId,
			request,
			settled,
			settle: (outcome) => {
				if (!this.#entries.delete(rpcId)) return;
				resolveSettled(outcome);
				this.#emitResolved(entry, outcome);
			},
		};
		this.#entries.set(rpcId, entry);
		input.signal?.addEventListener(
			"abort",
			() => {
				entry.settle({ kind: "aborted" });
			},
			{ once: true },
		);
		this.#emit(input.sessionId, request);
		return entry;
	}

	#settle(entry: PendingEntry, outcome: PendingOutcome): void {
		entry.settle(outcome);
	}

	#emitResolved(entry: PendingEntry, outcome: PendingOutcome): void {
		if (entry.kind === "approval") {
			const decision = outcome.kind === "approval" ? outcome.decision : "cancelled";
			this.#emit(entry.sessionId, {
				push: "approval.resolved",
				data: { sessionId: entry.sessionId, approvalId: entry.approvalId, outcome: decision },
			});
			return;
		}
		this.#emit(entry.sessionId, {
			push: "question.resolved",
			data: {
				sessionId: entry.sessionId,
				questionRpcId: entry.rpcId,
				outcome: outcome.kind === "question" ? "answered" : "cancelled",
			},
		});
	}
}

function normalizeAnswers(
	answers: readonly { readonly id: string; readonly selected: unknown; readonly custom?: string }[],
): readonly QuestionAnswerItem[] {
	return answers.map((answer) => {
		const selected = Array.isArray(answer.selected)
			? answer.selected.filter((item): item is string => typeof item === "string")
			: typeof answer.selected === "string"
				? [answer.selected]
				: [];
		return {
			id: answer.id,
			selected,
			...(answer.custom === undefined ? {} : { custom: answer.custom }),
		};
	});
}
