/**
 * In-process apiProxy hub.
 *
 * One mux iterator + one host iterator are shared across every authenticated
 * mobile connection. Unary methods (`list` / `history` / `prompt` / `cancel` /
 * `respond`) mint a fresh `rpcId` with `crypto.randomUUID()` and fold the
 * host `RpcResult` into a plain `{ok,value}|{ok:false,error}` — never leaking
 * `details` or prompt text.
 *
 * Iterator death is logged (no tokens / keys / payloads) and retried with
 * backoff. After a reconnect the phone should subscribe again; frames that
 * arrived while the stream was down are not replayed by this plugin.
 */

import { randomUUID } from "node:crypto";
import type { HostApiProxy, HostRpcResult, MobileRemoteLogger } from "./context.js";

export type PushKind =
	| "session.event"
	| "session.subscribed"
	| "approval.requested"
	| "approval.resolved"
	| "question.requested"
	| "question.resolved"
	| "session.queue"
	| "host.event";

export interface PushEnvelope {
	readonly push: PushKind;
	readonly data: unknown;
	readonly rpcId?: string;
}

export interface Subscriber {
	send(push: PushEnvelope): void;
	readonly sessionIds: Set<string>;
	host: boolean;
}

export type FoldedResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: FoldedError };

export interface FoldedError {
	readonly code: string;
	readonly message: string;
}

export interface SessionListItem {
	readonly sessionId: string;
	readonly title?: string;
	readonly running: boolean;
	readonly blank: boolean;
	readonly updatedAt: number;
	readonly cwd?: string;
}

export interface SessionListResult {
	readonly items: SessionListItem[];
}

export interface HistoryParams {
	readonly sessionId: string;
	readonly beforeSeq?: number;
	readonly maxMessages?: number;
}

export interface HistoryResult {
	readonly events: unknown[];
	readonly hasMore: boolean;
}

export interface PromptParams {
	readonly sessionId: string;
	readonly mode: "queue" | "steer";
	readonly text: string;
	readonly clientTimeZone?: string;
}

export type RespondInput =
	| {
			readonly kind: "approval";
			readonly rpcId: string;
			readonly sessionId: string;
			readonly approvalId: string;
			readonly outcome: "allowed-once" | "rejected";
	  }
	| {
			readonly kind: "question";
			readonly rpcId: string;
			readonly sessionId: string;
			readonly answers: readonly { readonly id: string; readonly selected: unknown; readonly custom?: string }[];
	  };

export interface UpstreamHub {
	addSubscriber(subscriber: Subscriber): void;
	removeSubscriber(subscriber: Subscriber): void;
	subscribeSession(subscriber: Subscriber, sessionId: string): void;
	unsubscribeSession(subscriber: Subscriber, sessionId: string): void;
	subscribeHost(subscriber: Subscriber): void;
	list(): Promise<FoldedResult<SessionListResult>>;
	history(params: HistoryParams): Promise<FoldedResult<HistoryResult>>;
	prompt(params: PromptParams): Promise<FoldedResult<unknown>>;
	cancel(sessionId: string): Promise<FoldedResult<unknown>>;
	create(params: { cwd?: string }): Promise<FoldedResult<{ sessionId: string }>>;
	respond(input: RespondInput): Promise<FoldedResult<unknown>>;
	stop(): void;
}

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 15_000;
const HUGE_STRING = 4_096;

export interface UpstreamHubOptions {
	/** Optional side-effect hook (e.g. offline push). Must not throw into mux. */
	readonly onApprovalRequested?: (push: PushEnvelope) => void;
}

export function createUpstreamHub(
	apiProxySource: HostApiProxy | undefined | (() => HostApiProxy | undefined),
	logger: MobileRemoteLogger,
	options: UpstreamHubOptions = {},
): UpstreamHub {
	const subscribers = new Set<Subscriber>();
	const controller = new AbortController();
	let streaming = false;
	let muxTask: Promise<void> | null = null;
	let hostTask: Promise<void> | null = null;
	const resolveApiProxy = (): HostApiProxy | undefined =>
		typeof apiProxySource === "function" ? apiProxySource() : apiProxySource;

	const unavailable = (what: string): FoldedError => ({
		code: "upstream_error",
		message: `${what} is unavailable`,
	});

	const addSubscriber = (subscriber: Subscriber): void => {
		subscribers.add(subscriber);
	};

	const removeSubscriber = (subscriber: Subscriber): void => {
		subscribers.delete(subscriber);
	};

	const ensureStreaming = (): void => {
		if (streaming || controller.signal.aborted) return;
		streaming = true;
		muxTask = runIterator("mux", controller.signal, logger, async (signal) => {
			const apiProxy = resolveApiProxy();
			if (apiProxy === undefined) throw new Error("apiProxy is unavailable");
			for await (const frame of apiProxy.events.mux({ rpcId: randomUUID(), payload: {} }, signal)) {
				if (signal.aborted) return;
				const mapped = mapMuxFrame(frame.rpcId, frame.payload);
				if (mapped === null) continue;
				const sessionId = sessionIdOf(mapped.data);
				if (sessionId === null) continue;
				if (mapped.push === "approval.requested" && options.onApprovalRequested !== undefined) {
					try {
						options.onApprovalRequested(mapped);
					} catch {
						logger.warn("approval push hook failed (details redacted)");
					}
				}
				for (const subscriber of subscribers) {
					if (subscriber.sessionIds.has(sessionId)) subscriber.send(mapped);
				}
			}
		});
		hostTask = runIterator("host", controller.signal, logger, async (signal) => {
			const apiProxy = resolveApiProxy();
			if (apiProxy === undefined) throw new Error("apiProxy is unavailable");
			for await (const frame of apiProxy.events.host({ rpcId: randomUUID(), payload: {} }, signal)) {
				if (signal.aborted) return;
				const mapped = mapHostFrame(frame.payload);
				if (mapped === null) continue;
				for (const subscriber of subscribers) {
					if (subscriber.host) subscriber.send(mapped);
				}
			}
		});
		void muxTask;
		void hostTask;
	};

	const subscribeSession = (subscriber: Subscriber, sessionId: string): void => {
		subscriber.sessionIds.add(sessionId);
		ensureStreaming();
	};

	const unsubscribeSession = (subscriber: Subscriber, sessionId: string): void => {
		subscriber.sessionIds.delete(sessionId);
	};

	const subscribeHost = (subscriber: Subscriber): void => {
		subscriber.host = true;
		ensureStreaming();
	};

	const list = async (): Promise<FoldedResult<SessionListResult>> => {
		const apiProxy = resolveApiProxy();
		if (apiProxy === undefined) return { ok: false, error: unavailable("apiProxy") };
		const folded = await callUnary(apiProxy.sessions.list.bind(apiProxy.sessions), {});
		if (!folded.ok) return folded;
		const items = Array.isArray(folded.value.items) ? folded.value.items : [];
		return {
			ok: true,
			value: {
				items: items
					.map(mapSessionItem)
					.filter((item): item is SessionListItem => item !== null && item.blank !== true),
			},
		};
	};

	const history = async (params: HistoryParams): Promise<FoldedResult<HistoryResult>> => {
		const apiProxy = resolveApiProxy();
		if (apiProxy === undefined) return { ok: false, error: unavailable("apiProxy") };
		const payload: { sessionId: string; beforeSeq?: number; maxMessages?: number } = { sessionId: params.sessionId };
		if (params.beforeSeq !== undefined) payload.beforeSeq = params.beforeSeq;
		if (params.maxMessages !== undefined) payload.maxMessages = params.maxMessages;
		const folded = await callUnary(apiProxy.sessions.history.bind(apiProxy.sessions), payload);
		if (!folded.ok) return folded;
		const events = Array.isArray(folded.value.events) ? folded.value.events.map((entry) => stripHugeData(entry)) : [];
		return { ok: true, value: { events, hasMore: folded.value.hasMore === true } };
	};

	const prompt = async (params: PromptParams): Promise<FoldedResult<unknown>> => {
		const apiProxy = resolveApiProxy();
		if (apiProxy === undefined) return { ok: false, error: unavailable("apiProxy") };
		const payload: {
			sessionId: string;
			mode: "queue" | "steer";
			content: Array<{ type: "text"; text: string }>;
			clientTimeZone?: string;
		} = {
			sessionId: params.sessionId,
			mode: params.mode,
			content: [{ type: "text", text: params.text }],
		};
		if (params.clientTimeZone !== undefined) payload.clientTimeZone = params.clientTimeZone;
		return callUnary(apiProxy.sessions.prompt.bind(apiProxy.sessions), payload);
	};

	const cancel = async (sessionId: string): Promise<FoldedResult<unknown>> => {
		const apiProxy = resolveApiProxy();
		if (apiProxy === undefined) return { ok: false, error: unavailable("apiProxy") };
		return callUnary(apiProxy.sessions.cancel.bind(apiProxy.sessions), { sessionId });
	};

	const create = async (params: { cwd?: string }): Promise<FoldedResult<{ sessionId: string }>> => {
		const apiProxy = resolveApiProxy();
		if (apiProxy === undefined) return { ok: false, error: unavailable("apiProxy") };
		const createFn = apiProxy.sessions.create;
		if (typeof createFn !== "function") {
			return { ok: false, error: { code: "upstream_error", message: "session.create is unavailable" } };
		}
		const payload: { cwd?: string } = {};
		if (typeof params.cwd === "string" && params.cwd.length > 0) payload.cwd = params.cwd;
		const folded = await callUnary(createFn.bind(apiProxy.sessions), payload);
		if (!folded.ok) return folded;
		const sessionId = (folded.value as { sessionId?: unknown }).sessionId;
		if (typeof sessionId !== "string" || sessionId.length === 0) {
			return { ok: false, error: { code: "upstream_error", message: "create returned no sessionId" } };
		}
		return { ok: true, value: { sessionId } };
	};

	const respond = async (input: RespondInput): Promise<FoldedResult<unknown>> => {
		const apiProxy = resolveApiProxy();
		if (apiProxy === undefined) return { ok: false, error: unavailable("apiProxy") };
		const value =
			input.kind === "approval"
				? { sessionId: input.sessionId, approvalId: input.approvalId, outcome: input.outcome }
				: { sessionId: input.sessionId, answer: { answers: input.answers } };
		try {
			const receipt = await apiProxy.respond({
				type: "client-response",
				rpcId: input.rpcId,
				result: { ok: true, value },
			});
			if (isRejectedReceipt(receipt)) {
				const reason = typeof receipt.reason === "string" ? receipt.reason : "not-pending";
				return { ok: false, error: { code: "upstream_error", message: reason } };
			}
			return { ok: true, value: { accepted: true } };
		} catch (error) {
			return { ok: false, error: foldThrown(error) };
		}
	};

	const stop = (): void => {
		controller.abort();
		subscribers.clear();
	};

	return {
		addSubscriber,
		removeSubscriber,
		subscribeSession,
		unsubscribeSession,
		subscribeHost,
		list,
		history,
		prompt,
		cancel,
		create,
		respond,
		stop,
	};
}

async function callUnary<P, T>(
	method: (request: { rpcId: string; payload: P }) => Promise<{ rpcId: string; result: HostRpcResult<T> }>,
	payload: P,
): Promise<FoldedResult<T>> {
	try {
		const response = await method({ rpcId: randomUUID(), payload });
		return foldResult(response?.result);
	} catch (error) {
		return { ok: false, error: foldThrown(error) };
	}
}

function foldResult<T>(result: HostRpcResult<T> | undefined): FoldedResult<T> {
	if (result === undefined) {
		return { ok: false, error: { code: "upstream_error", message: "malformed upstream result" } };
	}
	if (result.ok === true) return { ok: true, value: result.value };
	const code = typeof result.error?.code === "string" && result.error.code.length > 0 ? result.error.code : "upstream_error";
	const message =
		typeof result.error?.message === "string" && result.error.message.length > 0 ? result.error.message : code;
	return { ok: false, error: { code, message } };
}

function foldThrown(error: unknown): FoldedError {
	if (error instanceof Error && error.message.length > 0) {
		return { code: "upstream_error", message: error.message };
	}
	return { code: "upstream_error", message: "upstream failed" };
}

function isRejectedReceipt(value: unknown): value is { accepted: false; reason?: string } {
	return typeof value === "object" && value !== null && (value as { accepted?: unknown }).accepted === false;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function sessionIdOf(data: unknown): string | null {
	const record = asRecord(data);
	return typeof record?.sessionId === "string" && record.sessionId.length > 0 ? record.sessionId : null;
}

function coerceTitle(value: unknown): string | undefined {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	}
	const record = asRecord(value);
	if (record === null) return undefined;
	for (const key of ["title", "value", "text"] as const) {
		const nested = record[key];
		if (typeof nested === "string" && nested.trim().length > 0) return nested.trim();
	}
	return undefined;
}

export function extractSessionTitle(projections: unknown): string | undefined {
	const block = asRecord(projections);
	const values = asRecord(block?.values);
	return (
		coerceTitle(values?.title) ??
		coerceTitle(values?.sessionTitle) ??
		coerceTitle(block?.title)
	);
}

export function mapSessionItem(raw: unknown): SessionListItem | null {
	const record = asRecord(raw);
	if (record === null || typeof record.sessionId !== "string" || record.sessionId.length === 0) return null;
	const title = extractSessionTitle(record.projections);
	const cwd = typeof record.cwd === "string" ? record.cwd : undefined;
	return {
		sessionId: record.sessionId,
		...(title === undefined ? {} : { title }),
		running: record.running === true,
		blank: record.blank === true,
		updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
		...(cwd === undefined ? {} : { cwd }),
	};
}

export function mapMuxFrame(rpcId: string, payload: unknown): PushEnvelope | null {
	const record = asRecord(payload);
	if (record === null || typeof record.type !== "string") return null;
	const sessionId = typeof record.sessionId === "string" ? record.sessionId : "";
	if (sessionId.length === 0) return null;
	switch (record.type) {
		case "session/event":
			return {
				push: "session.event",
				data: {
					sessionId,
					event: stripHugeData(record.event),
					...(record.view === undefined ? {} : { view: record.view }),
				},
			};
		case "session/subscribed":
			return {
				push: "session.subscribed",
				data: { sessionId, lastSeq: typeof record.lastSeq === "number" ? record.lastSeq : -1 },
			};
		case "approval/requested":
			return {
				push: "approval.requested",
				rpcId,
				data: {
					sessionId,
					approvalId: typeof record.approvalId === "string" ? record.approvalId : "",
					toolName: typeof record.toolName === "string" ? record.toolName : "",
					...(typeof record.callId === "string" ? { callId: record.callId } : {}),
					...(typeof record.reason === "string" ? { reason: record.reason } : {}),
				},
			};
		case "approval/resolved":
			return {
				push: "approval.resolved",
				data: {
					sessionId,
					approvalId: typeof record.approvalId === "string" ? record.approvalId : "",
					outcome: record.outcome,
				},
			};
		case "question/requested":
			return {
				push: "question.requested",
				rpcId,
				data: { sessionId, questions: Array.isArray(record.questions) ? record.questions : [] },
			};
		case "question/resolved":
			return {
				push: "question.resolved",
				data: {
					sessionId,
					questionRpcId: typeof record.questionRpcId === "string" ? record.questionRpcId : "",
					outcome: record.outcome,
				},
			};
		case "session/queue":
			return {
				push: "session.queue",
				data: { sessionId, items: summarizeQueueItems(record.items) },
			};
		default:
			return null;
	}
}

export function mapHostFrame(payload: unknown): PushEnvelope | null {
	const record = asRecord(payload);
	if (record === null || typeof record.type !== "string") return null;
	switch (record.type) {
		case "host/session-added": {
			const sessionId = typeof record.sessionId === "string" ? record.sessionId : "";
			if (sessionId.length === 0) return null;
			return {
				push: "host.event",
				data: {
					type: record.type,
					sessionId,
					blank: record.blank === true,
					...(typeof record.cwd === "string" ? { cwd: record.cwd } : {}),
				},
			};
		}
		case "host/session-removed": {
			const sessionId = typeof record.sessionId === "string" ? record.sessionId : "";
			if (sessionId.length === 0) return null;
			return { push: "host.event", data: { type: record.type, sessionId } };
		}
		case "host/session-status": {
			const sessionId = typeof record.sessionId === "string" ? record.sessionId : "";
			if (sessionId.length === 0) return null;
			return {
				push: "host.event",
				data: { type: record.type, sessionId, running: record.running === true },
			};
		}
		case "host/agent-error": {
			const sessionId = typeof record.sessionId === "string" ? record.sessionId : "";
			if (sessionId.length === 0) return null;
			return {
				push: "host.event",
				data: {
					type: record.type,
					sessionId,
					message: typeof record.message === "string" ? record.message : "",
				},
			};
		}
		default:
			return null;
	}
}

function summarizeQueueItems(items: unknown): Array<{ id: string; placement: string; text: string }> {
	if (!Array.isArray(items)) return [];
	return items.map((item) => {
		const record = asRecord(item);
		return {
			id: typeof record?.id === "string" ? record.id : "",
			placement: typeof record?.placement === "string" ? record.placement : "queued",
			text: truncate(extractText(record?.message), 160),
		};
	});
}

export function extractText(value: unknown): string {
	if (typeof value === "string") return value;
	const record = asRecord(value);
	if (record === null) {
		if (Array.isArray(value)) return value.map(extractText).filter((part) => part.length > 0).join("");
		return "";
	}
	if (typeof record.text === "string") return record.text;
	if (typeof record.content === "string") return record.content;
	if (Array.isArray(record.content)) return record.content.map(extractText).filter((part) => part.length > 0).join("");
	if (record.message !== undefined) return extractText(record.message);
	if (record.chunk !== undefined) return extractText(record.chunk);
	if (record.delta !== undefined) return extractText(record.delta);
	return "";
}

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function stripHugeData(value: unknown, depth = 0): unknown {
	if (depth > 8) return value;
	if (typeof value === "string") return value.length > HUGE_STRING ? "[omitted]" : value;
	if (Array.isArray(value)) return value.map((entry) => stripHugeData(entry, depth + 1));
	const record = asRecord(value);
	if (record === null) return value;
	const output: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(record)) {
		if (key === "data" && typeof entry === "string" && entry.length > 256) {
			output[key] = "[omitted]";
		} else {
			output[key] = stripHugeData(entry, depth + 1);
		}
	}
	return output;
}

async function runIterator(
	name: string,
	signal: AbortSignal,
	logger: MobileRemoteLogger,
	iterate: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
	let backoff = INITIAL_BACKOFF_MS;
	while (!signal.aborted) {
		try {
			await iterate(signal);
			if (signal.aborted) return;
			logger.warn(`upstream ${name} iterator ended; reconnecting`);
		} catch {
			if (signal.aborted) return;
			logger.warn(`upstream ${name} iterator failed; reconnecting`);
		}
		await sleep(backoff, signal);
		backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
	}
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) {
			resolve();
			return;
		}
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
	});
}
