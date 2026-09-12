/**
 * In-process `sessionController` backend (DSH 0.1.5+).
 *
 * DSH 0.1.5 replaced `apiProxy` with the Session Remote service: unary reads
 * (`list` / `page`), Agent commands (`prompt` / `cancel` / `create`) and two
 * async iterables per Session (`follow` for durable events plus optional
 * assistant frames). This module keeps the {@link UpstreamHub} contract of the
 * legacy apiProxy backend so the mobile data plane, RPC allowlist, and push
 * vocabulary stay unchanged:
 *
 * - one `follow` iterator per subscribed Session, started lazily and torn
 *   down when the last subscriber leaves;
 * - a per-Session delivered-sequence watermark so a phone that already pulled
 *   history never sees the same durable event twice after (re)subscribing;
 * - live approvals / questions answered through {@link InteractionRegistry}
 *   (`approval/request` and `user-questions/request` waterfalls);
 * - session-list state mirrored from the host's `api-session/*` events.
 */

import { randomUUID } from "node:crypto";
import type { MobileRemoteLogger } from "./context.js";
import { InteractionRegistry } from "./interactions.js";
import {
	type FoldedError,
	type FoldedResult,
	type HistoryParams,
	type HistoryResult,
	mapSessionItem,
	type PromptParams,
	type PushEnvelope,
	type RespondInput,
	runIterator,
	type SessionListItem,
	type SessionListResult,
	type Subscriber,
	stripHugeData,
	type UpstreamHub,
} from "./upstream.js";

export interface SessionAddressFace {
	readonly kind: "session";
	readonly sessionId: string;
}

export interface SessionControllerFace {
	list(request: { readonly cursor?: string }, signal: AbortSignal): Promise<{ readonly items?: readonly unknown[] }>;
	page(
		request: {
			readonly address: SessionAddressFace;
			readonly throughSeq: number;
			readonly beforeSeq?: number;
			readonly maxMessages?: number;
		},
		signal: AbortSignal,
	): Promise<{ readonly records?: readonly unknown[]; readonly hasMore?: boolean }>;
	follow(
		request: {
			readonly address: SessionAddressFace;
			readonly maxMessages?: number;
			readonly assistantStream?: boolean;
		},
		signal: AbortSignal,
	): AsyncIterable<unknown>;
	prompt(
		request: {
			readonly requestId: string;
			readonly sessionId: string;
			readonly mode: "queue" | "steer";
			readonly content: readonly { readonly type: "text"; readonly text: string }[];
			readonly clientTimeZone?: string;
		},
		signal?: AbortSignal,
	): Promise<unknown>;
	cancel(request: { readonly sessionId: string }): unknown;
	create(request: { readonly cwd?: string }): Promise<unknown>;
	inspect?(sessionId: string, signal?: AbortSignal): Promise<{ readonly events?: readonly unknown[] }>;
}

/** Cordis host context narrowed to the event face this backend mirrors. */
export interface HostEventSource {
	on?(name: string, listener: (...args: never[]) => unknown, options?: unknown): unknown;
}

export interface SessionControllerUpstreamOptions {
	/** Optional side-effect hook (e.g. offline push). Must not throw into feeds. */
	readonly onApprovalRequested?: (push: PushEnvelope) => void;
	/** Host context used to mirror `api-session/*` list state to phones. */
	readonly hostEvents?: HostEventSource | undefined;
	/** Shared registry when the approval bridge already created one. */
	readonly interactions?: InteractionRegistry | undefined;
	readonly readTimeoutMs?: number;
	readonly writeTimeoutMs?: number;
}

const DEFAULT_READ_TIMEOUT_MS = 30_000;
const DEFAULT_WRITE_TIMEOUT_MS = 120_000;
const FEED_OPENING_MESSAGES = 40;
/** A temporary phone disconnect must not cancel a card the user still sees. */
const APPROVAL_GRACE_MS = 30_000;

export function isSessionController(value: unknown): value is SessionControllerFace {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<SessionControllerFace>;
	return (
		typeof candidate.list === "function" &&
		typeof candidate.page === "function" &&
		typeof candidate.follow === "function" &&
		typeof candidate.prompt === "function" &&
		typeof candidate.cancel === "function" &&
		typeof candidate.create === "function"
	);
}

interface FeedState {
	readonly sessionId: string;
	readonly abort: AbortController;
	cursor: number | null;
	watermark: number;
	readonly ready: Promise<void>;
	readonly opened: () => void;
}

/**
 * Build the sessionController-backed hub. The controller is resolved lazily so
 * a capability that appears after apply() (or disappears on host reload)
 * becomes usable without reloading the plugin.
 */
export function createSessionControllerUpstream(
	controllerSource: SessionControllerFace | undefined | (() => SessionControllerFace | undefined),
	logger: MobileRemoteLogger,
	options: SessionControllerUpstreamOptions = {},
): UpstreamHub {
	const subscribers = new Set<Subscriber>();
	const feeds = new Map<string, FeedState>();
	const watermarks = new Map<string, number>();
	const cursors = new Map<string, number>();
	const graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
	const disposers: Array<() => void> = [];
	const readTimeoutMs = options.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
	const writeTimeoutMs = options.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS;
	const resolveController = (): SessionControllerFace | undefined =>
		typeof controllerSource === "function" ? controllerSource() : controllerSource;
	const interactions =
		options.interactions ??
		new InteractionRegistry({
			emit: (sessionId, push) => {
				if (push.push === "approval.requested" && options.onApprovalRequested !== undefined) {
					try {
						options.onApprovalRequested(push);
					} catch {
						logger.warn("approval push hook failed (details redacted)");
					}
				}
				broadcastToSession(sessionId, push);
			},
		});

	const unavailable = (what: string): FoldedError => ({
		code: "upstream_error",
		message: `${what} is unavailable`,
	});

	const broadcastToSession = (sessionId: string, push: PushEnvelope): void => {
		for (const subscriber of subscribers) {
			if (subscriber.sessionIds.has(sessionId)) subscriber.send(push);
		}
	};

	const broadcastHost = (data: unknown): void => {
		const push: PushEnvelope = { push: "host.event", data };
		for (const subscriber of subscribers) {
			if (subscriber.host) subscriber.send(push);
		}
	};

	const watches = (sessionId: string): boolean => {
		for (const subscriber of subscribers) {
			if (subscriber.sessionIds.has(sessionId)) return true;
		}
		return false;
	};

	const stopFeed = (sessionId: string): void => {
		const feed = feeds.get(sessionId);
		if (feed === undefined) return;
		feeds.delete(sessionId);
		feed.abort.abort();
	};

	/**
	 * An unanswered card cannot outlive its audience: once the last phone
	 * watching a Session leaves, fail its pending asks closed after a grace
	 * window that absorbs a page refresh or a short network drop.
	 */
	const scheduleSettle = (sessionId: string): void => {
		const existing = graceTimers.get(sessionId);
		if (existing !== undefined) clearTimeout(existing);
		const timer = setTimeout(() => {
			graceTimers.delete(sessionId);
			if (!watches(sessionId)) interactions.settleSession(sessionId);
		}, APPROVAL_GRACE_MS);
		timer.unref?.();
		graceTimers.set(sessionId, timer);
	};

	const cancelSettle = (sessionId: string): void => {
		const existing = graceTimers.get(sessionId);
		if (existing === undefined) return;
		clearTimeout(existing);
		graceTimers.delete(sessionId);
	};

	const deliverEvent = (feed: FeedState, raw: unknown): void => {
		const outer = asRecord(raw);
		const event = asRecord(outer?.event) ?? outer;
		if (event === null) return;
		const seq = typeof event.seq === "number" ? event.seq : null;
		if (seq === null || seq <= feed.watermark) return;
		feed.watermark = seq;
		feed.cursor = seq;
		cursors.set(feed.sessionId, seq);
		watermarks.set(feed.sessionId, seq);
		broadcastToSession(feed.sessionId, {
			push: "session.event",
			data: { sessionId: feed.sessionId, event: stripHugeData(event) },
		});
	};

	const deliverStreamFrame = (feed: FeedState, raw: unknown): void => {
		const frame = asRecord(raw);
		if (frame?.type !== "chunk") return;
		const chunk = asRecord(frame.chunk);
		if (chunk?.type !== "text-delta" || typeof chunk.text !== "string" || chunk.text.length === 0) return;
		broadcastToSession(feed.sessionId, {
			push: "session.event",
			data: {
				sessionId: feed.sessionId,
				event: {
					type: "assistant/chunk",
					seq: feed.watermark,
					time: typeof frame.time === "number" ? frame.time : Date.now(),
					data: { type: "text-delta", index: typeof chunk.index === "number" ? chunk.index : 0, text: chunk.text },
				},
			},
		});
	};

	const handleFrame = (feed: FeedState, raw: unknown): void => {
		const record = asRecord(raw);
		if (record === null) return;
		if (record.type === "snapshot") {
			if (typeof record.cursor === "number") {
				feed.cursor = record.cursor;
				cursors.set(feed.sessionId, record.cursor);
			}
			// A phone that already pulled history must not replay the opening
			// window; subscribers that never asked for history start from the
			// snapshot cursor (their own list/history calls fill the past).
			if (feed.watermark < 0 && feed.cursor !== null) feed.watermark = feed.cursor;
			const records = Array.isArray(record.records) ? record.records : [];
			for (const entry of records) deliverEvent(feed, entry);
			feed.opened();
			return;
		}
		if (record.type === "event") {
			deliverEvent(feed, record.event);
			return;
		}
		if (record.type === "assistant-stream") {
			deliverStreamFrame(feed, record.frame);
		}
	};

	const runFeed = (feed: FeedState): Promise<void> =>
		runIterator(`session feed`, feed.abort.signal, logger, async (signal) => {
			const controller = resolveController();
			if (controller === undefined) throw new Error("sessionController is unavailable");
			const stream = controller.follow(
				{
					address: { kind: "session", sessionId: feed.sessionId },
					maxMessages: FEED_OPENING_MESSAGES,
					assistantStream: true,
				},
				signal,
			);
			for await (const frame of stream) {
				if (signal.aborted) return;
				handleFrame(feed, frame);
			}
		});

	const ensureFeed = (sessionId: string): FeedState => {
		const existing = feeds.get(sessionId);
		if (existing !== undefined) return existing;
		const feed: FeedState = {
			sessionId,
			abort: new AbortController(),
			cursor: null,
			watermark: watermarks.get(sessionId) ?? -1,
			...opening(),
		};
		feeds.set(sessionId, feed);
		void runFeed(feed);
		return feed;
	};

	// 订阅确认必须晚于快照，超时与卸载也必须结束等待。
	function opening(): Pick<FeedState, "ready" | "opened"> {
		let opened = () => {};
		const ready = new Promise<void>((resolve) => {
			opened = resolve;
		});
		return { ready, opened: () => opened() };
	}

	const registerHostEvents = (): void => {
		const source = options.hostEvents;
		const on = source?.on;
		if (source === undefined || typeof on !== "function") return;
		const listen = (name: string, handler: (...args: unknown[]) => void): void => {
			try {
				disposers.push(asDisposer(on.call(source, name, handler)));
			} catch {
				logger.warn(`mobile-remote: host event ${name} could not be observed`);
			}
		};
		listen("api-session/added", (summary) => {
			const record = asRecord(summary);
			if (typeof record?.sessionId !== "string") return;
			broadcastHost({
				type: "host/session-added",
				sessionId: record.sessionId,
				blank: record.blank === true,
				...(typeof record.cwd === "string" ? { cwd: record.cwd } : {}),
			});
		});
		listen("api-session/removed", (sessionId) => {
			if (typeof sessionId !== "string") return;
			stopFeed(sessionId);
			broadcastHost({ type: "host/session-removed", sessionId });
		});
		listen("api-session/status", (sessionId, running) => {
			if (typeof sessionId !== "string") return;
			broadcastHost({ type: "host/session-status", sessionId, running: running === true });
		});
		listen("api-session/error", (sessionId, message) => {
			if (typeof sessionId !== "string") return;
			broadcastHost({
				type: "host/agent-error",
				sessionId,
				message: typeof message === "string" ? message : "",
			});
		});
	};
	registerHostEvents();

	const addSubscriber = (subscriber: Subscriber): void => {
		subscribers.add(subscriber);
	};

	const removeSubscriber = (subscriber: Subscriber): void => {
		subscribers.delete(subscriber);
		for (const sessionId of [...feeds.keys()]) {
			if (watches(sessionId)) continue;
			stopFeed(sessionId);
			scheduleSettle(sessionId);
		}
	};

	const subscribeSession = async (subscriber: Subscriber, sessionId: string): Promise<void> => {
		cancelSettle(sessionId);
		subscriber.sessionIds.add(sessionId);
		const feed = ensureFeed(sessionId);
		const scoped = scopedSignal(readTimeoutMs);
		const signal = AbortSignal.any([scoped.signal, feed.abort.signal]);
		let onAbort = () => {};
		try {
			await Promise.race([
				feed.ready,
				new Promise<never>((_, reject) => {
					onAbort = () => reject(new Error("session subscription interrupted or timed out"));
					if (signal.aborted) onAbort();
					else signal.addEventListener("abort", onAbort, { once: true });
				}),
			]);
			interactions.replay(sessionId, (push) => subscriber.send(push));
		} catch (error) {
			unsubscribeSession(subscriber, sessionId);
			throw error;
		} finally {
			signal.removeEventListener("abort", onAbort);
			scoped.dispose();
		}
	};

	const unsubscribeSession = (subscriber: Subscriber, sessionId: string): void => {
		subscriber.sessionIds.delete(sessionId);
		if (watches(sessionId)) return;
		stopFeed(sessionId);
		scheduleSettle(sessionId);
	};

	const subscribeHost = (subscriber: Subscriber): void => {
		subscriber.host = true;
	};

	const list = async (): Promise<FoldedResult<SessionListResult>> => {
		const controller = resolveController();
		if (controller === undefined) return { ok: false, error: unavailable("sessionController") };
		const scoped = scopedSignal(readTimeoutMs);
		try {
			const value = await controller.list({}, scoped.signal);
			const items = Array.isArray(value?.items) ? value.items : [];
			const mapped = items
				.map(mapSessionItem)
				.filter((item): item is SessionListItem => item !== null && item.blank !== true);
			return { ok: true, value: { items: mapped } };
		} catch (error) {
			return { ok: false, error: foldThrown(error) };
		} finally {
			scoped.dispose();
		}
	};

	/**
	 * Resolve the log cut a page must not pass. A live follow feed updates its
	 * cursor continuously; a cold read inspects the persisted log, which is the
	 * only cheap way to learn the current tail. Backwards pages reuse the cached
	 * cut because `beforeSeq` already bounds them, but the newest page always
	 * re-reads so a phone that opened a Session later still sees the full tail.
	 */
	const readCursor = async (
		controller: SessionControllerFace,
		sessionId: string,
		options: { readonly fresh: boolean },
	): Promise<number | null> => {
		const feed = feeds.get(sessionId);
		if (feed !== undefined && feed.cursor !== null) return feed.cursor;
		const cached = cursors.get(sessionId);
		if (!options.fresh && cached !== undefined) return cached;
		if (typeof controller.inspect === "function") {
			const scoped = scopedSignal(readTimeoutMs);
			try {
				const inspection = await controller.inspect(sessionId, scoped.signal);
				const events = Array.isArray(inspection?.events) ? inspection.events : [];
				const last = asRecord(events.at(-1));
				if (typeof last?.seq === "number") {
					cursors.set(sessionId, last.seq);
					return last.seq;
				}
				return -1;
			} catch (error) {
				logger.warn(`mobile-remote: session inspect failed (${errorName(error)}); falling back to a follow opening`);
			} finally {
				scoped.dispose();
			}
		}
		return readCursorViaFollow(controller, sessionId);
	};

	const readCursorViaFollow = async (controller: SessionControllerFace, sessionId: string): Promise<number | null> => {
		const scoped = new AbortController();
		try {
			const stream = controller.follow({ address: { kind: "session", sessionId }, maxMessages: 1 }, scoped.signal);
			for await (const frame of stream) {
				const record = asRecord(frame);
				if (record?.type === "snapshot" && typeof record.cursor === "number") {
					cursors.set(sessionId, record.cursor);
					return record.cursor;
				}
			}
			return null;
		} catch (error) {
			logger.warn(`mobile-remote: session cursor lookup failed (${errorName(error)})`);
			return null;
		} finally {
			scoped.abort();
		}
	};

	const history = async (params: HistoryParams): Promise<FoldedResult<HistoryResult>> => {
		const controller = resolveController();
		if (controller === undefined) return { ok: false, error: unavailable("sessionController") };
		const scoped = scopedSignal(readTimeoutMs);
		try {
			const cursor = await readCursor(controller, params.sessionId, { fresh: params.beforeSeq === undefined });
			if (cursor === null) {
				return { ok: false, error: { code: "upstream_error", message: "session cursor is unavailable" } };
			}
			const page = await controller.page(
				{
					address: { kind: "session", sessionId: params.sessionId },
					throughSeq: cursor,
					...(params.beforeSeq === undefined ? {} : { beforeSeq: params.beforeSeq }),
					...(params.maxMessages === undefined ? {} : { maxMessages: params.maxMessages }),
				},
				scoped.signal,
			);
			const records = Array.isArray(page?.records) ? page.records : [];
			const events: unknown[] = [];
			for (const entry of records) {
				const record = asRecord(entry);
				const event = record?.event;
				if (event === undefined) continue;
				events.push(stripHugeData(event));
			}
			return { ok: true, value: { events, hasMore: page?.hasMore === true } };
		} catch (error) {
			return { ok: false, error: foldThrown(error) };
		} finally {
			scoped.dispose();
		}
	};

	const prompt = async (params: PromptParams): Promise<FoldedResult<unknown>> => {
		const controller = resolveController();
		if (controller === undefined) return { ok: false, error: unavailable("sessionController") };
		const scoped = scopedSignal(writeTimeoutMs);
		try {
			const value = await controller.prompt(
				{
					requestId: randomUUID(),
					sessionId: params.sessionId,
					mode: params.mode,
					content: [{ type: "text", text: params.text }],
					...(params.clientTimeZone === undefined ? {} : { clientTimeZone: params.clientTimeZone }),
				},
				scoped.signal,
			);
			return { ok: true, value };
		} catch (error) {
			return { ok: false, error: foldThrown(error) };
		} finally {
			scoped.dispose();
		}
	};

	const cancel = async (sessionId: string): Promise<FoldedResult<unknown>> => {
		const controller = resolveController();
		if (controller === undefined) return { ok: false, error: unavailable("sessionController") };
		try {
			const value = controller.cancel({ sessionId });
			return { ok: true, value: value ?? { accepted: true } };
		} catch (error) {
			return { ok: false, error: foldThrown(error) };
		}
	};

	const create = async (params: { cwd?: string }): Promise<FoldedResult<{ sessionId: string }>> => {
		const controller = resolveController();
		if (controller === undefined) return { ok: false, error: unavailable("sessionController") };
		const scoped = scopedSignal(writeTimeoutMs);
		try {
			const value = await controller.create(
				typeof params.cwd === "string" && params.cwd.length > 0 ? { cwd: params.cwd } : {},
			);
			const sessionId = asRecord(value)?.sessionId;
			if (typeof sessionId !== "string" || sessionId.length === 0) {
				return { ok: false, error: { code: "upstream_error", message: "create returned no sessionId" } };
			}
			return { ok: true, value: { sessionId } };
		} catch (error) {
			return { ok: false, error: foldThrown(error) };
		} finally {
			scoped.dispose();
		}
	};

	const respond = async (input: RespondInput): Promise<FoldedResult<unknown>> => {
		if (interactions.complete(input)) return { ok: true, value: { accepted: true } };
		return { ok: false, error: { code: "upstream_error", message: "not-pending" } };
	};

	const stop = (): void => {
		for (const sessionId of [...feeds.keys()]) stopFeed(sessionId);
		for (const timer of graceTimers.values()) clearTimeout(timer);
		graceTimers.clear();
		subscribers.clear();
		interactions.stop();
		for (const dispose of disposers.splice(0)) {
			try {
				dispose();
			} catch {
				// Host-owned disposers must not turn plugin teardown into a failure.
			}
		}
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
		interactions,
		hasSessionSubscriber: watches,
		broadcastToSession,
	};
}

function scopedSignal(timeoutMs: number): { readonly signal: AbortSignal; dispose(): void } {
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort(new Error("mobile-remote: upstream request timed out"));
	}, timeoutMs);
	return {
		signal: controller.signal,
		dispose: () => {
			clearTimeout(timer);
		},
	};
}

function foldThrown(error: unknown): FoldedError {
	if (error instanceof Error && error.message.length > 0) {
		return { code: "upstream_error", message: error.message };
	}
	return { code: "upstream_error", message: "upstream failed" };
}

function errorName(error: unknown): string {
	return error instanceof Error ? error.name : "error";
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
