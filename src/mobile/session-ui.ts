/**
 * Pure helpers for mobile session activity strip and history cursor paging.
 */

export interface ActiveTool {
	readonly name: string;
	readonly callId?: string;
}

export interface HistoryCursor {
	readonly beforeSeq: number | null;
	readonly hasMore: boolean;
}

const DEFAULT_HISTORY_PAGE = 40;

export function historyPageSize(): number {
	return DEFAULT_HISTORY_PAGE;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

/** Unwrap a history/push entry to the inner event object. */
export function unwrapEvent(entry: unknown): Record<string, unknown> | null {
	const record = asRecord(entry);
	if (record === null) return null;
	return asRecord(record.event) ?? record;
}

/** Read a numeric seq from a history row (top-level or nested). */
export function eventSeq(entry: unknown): number | null {
	const record = asRecord(entry);
	if (record === null) return null;
	if (typeof record.seq === "number" && Number.isFinite(record.seq)) return record.seq;
	const event = asRecord(record.event);
	if (event !== null && typeof event.seq === "number" && Number.isFinite(event.seq)) return event.seq;
	return null;
}

/** Smallest seq among loaded events; used as `beforeSeq` for older pages. */
export function earliestSeq(events: readonly unknown[]): number | null {
	let min: number | null = null;
	for (const entry of events) {
		const seq = eventSeq(entry);
		if (seq === null) continue;
		if (min === null || seq < min) min = seq;
	}
	return min;
}

function toolIdentity(data: unknown): { name: string; callId?: string } {
	const row = asRecord(data);
	const name =
		typeof row?.name === "string" && row.name.length > 0
			? row.name
			: typeof row?.toolName === "string" && row.toolName.length > 0
				? row.toolName
				: "tool";
	const callId =
		typeof row?.callId === "string" && row.callId.length > 0
			? row.callId
			: typeof row?.id === "string" && row.id.length > 0
				? row.id
				: typeof row?.toolCallId === "string" && row.toolCallId.length > 0
					? row.toolCallId
					: undefined;
	return callId === undefined ? { name } : { name, callId };
}

/**
 * Tools that have a `tool/call` without a later matching `tool/result` or
 * `tool/error`. Matched by callId when present, otherwise by name (FIFO).
 */
export function activeTools(events: readonly unknown[]): ActiveTool[] {
	const open: ActiveTool[] = [];
	for (const entry of events) {
		const event = unwrapEvent(entry);
		if (event === null) continue;
		const type = event.type;
		if (type === "tool/call") {
			open.push(toolIdentity(event.data));
			continue;
		}
		if (type === "tool/result" || type === "tool/error" || type === "tool/cancelled") {
			const done = toolIdentity(event.data);
			const index =
				done.callId !== undefined
					? open.findIndex((item) => item.callId === done.callId)
					: open.findIndex((item) => item.name === done.name && item.callId === undefined);
			const fallback = index >= 0 || done.callId !== undefined ? index : open.findIndex((item) => item.name === done.name);
			if (fallback >= 0) open.splice(fallback, 1);
		}
	}
	return open;
}

export function mergeHistoryPage(
 existing: readonly unknown[], incoming: readonly unknown[], placement: "older" | "newer" = "older",
): unknown[] {
 // Legacy rows retain source order; only host sequences identify duplicates.
 const source = placement === "older" ? [...incoming, ...existing] : [...existing, ...incoming];
 const seen = new Set<number>();
 const merged = source.filter((entry) => {
  const seq = eventSeq(entry);
  if (seq === null) return true;
  if (seen.has(seq)) return false;
  seen.add(seq); return true;
 });
 const ordered = merged.filter((entry) => eventSeq(entry) !== null)
  .sort((left, right) => (eventSeq(left) as number) - (eventSeq(right) as number));
 let index = 0;
 // Sort the sequenced subsequence without a non-transitive mixed comparator.
 return merged.map((entry) => eventSeq(entry) === null ? entry : ordered[index++]);
}

export function historyCursorFromResult(
	events: readonly unknown[],
	hasMore: boolean,
): HistoryCursor {
	return {
		beforeSeq: earliestSeq(events),
		hasMore,
	};
}
