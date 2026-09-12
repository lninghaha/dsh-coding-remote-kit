import assert from "node:assert/strict";
import test from "node:test";
import {
	activeTools,
	earliestSeq,
	eventSeq,
	historyCursorFromResult,
	mergeHistoryPage,
	mergeSubscribedHistory,
} from "../lib/mobile/session-ui.js";

test("subscription buffer deduplicates durable events but preserves same-seq chunks", () => {
	const history = [{ seq: 3, type: "user/message" }];
	const chunks = ["hello", " world"].map(text => ({ event: { seq: 3, type: "assistant/chunk", data: { text } } }));
	const merged = mergeSubscribedHistory(history, [history[0], ...chunks, { event: { seq: 4, type: "assistant/message" } }]);
	assert.equal(merged.length, 4);
	assert.equal(mergeHistoryPage(merged, [{ seq: 2, type: "user/message" }]).length, 5);
	assert.equal(mergeSubscribedHistory([{ seq: 4, type: "assistant/message" }], chunks).length, 1);
});

test("eventSeq reads top-level and nested seq", () => {
	assert.equal(eventSeq({ seq: 12, event: { type: "user/message" } }), 12);
	assert.equal(eventSeq({ event: { type: "user/message", seq: 7 } }), 7);
	assert.equal(eventSeq({ event: { type: "user/message" } }), null);
});

test("earliestSeq returns the minimum loaded seq", () => {
	assert.equal(
		earliestSeq([
			{ seq: 40, event: { type: "assistant/message" } },
			{ seq: 12, event: { type: "user/message" } },
			{ seq: 28, event: { type: "tool/call", data: { name: "shell" } } },
		]),
		12,
	);
	assert.equal(earliestSeq([{ event: { type: "user/message" } }]), null);
});

test("activeTools tracks open tool/call until result/error", () => {
	const open = activeTools([
		{ seq: 1, event: { type: "tool/call", data: { name: "read", callId: "c1" } } },
		{ seq: 2, event: { type: "tool/call", data: { name: "shell", callId: "c2" } } },
		{ seq: 3, event: { type: "tool/result", data: { name: "read", callId: "c1" } } },
	]);
	assert.deepEqual(open, [{ name: "shell", callId: "c2" }]);

	const cleared = activeTools([
		...[
			{ seq: 1, event: { type: "tool/call", data: { name: "read", callId: "c1" } } },
			{ seq: 2, event: { type: "tool/call", data: { name: "shell", callId: "c2" } } },
			{ seq: 3, event: { type: "tool/result", data: { name: "read", callId: "c1" } } },
		],
		{ seq: 4, event: { type: "tool/error", data: { name: "shell", callId: "c2" } } },
	]);
	assert.deepEqual(cleared, []);
});

test("activeTools falls back to name matching without callId", () => {
	const open = activeTools([
		{ event: { type: "tool/call", data: { name: "grep" } } },
		{ event: { type: "tool/call", data: { name: "grep" } } },
		{ event: { type: "tool/result", data: { name: "grep" } } },
	]);
	assert.equal(open.length, 1);
	assert.equal(open[0]?.name, "grep");
});

test("mergeHistoryPage prepends older events without dropping newer ones", () => {
	const existing = [
		{ seq: 20, event: { type: "user/message", data: { text: "new" } } },
		{ seq: 21, event: { type: "assistant/message", data: { text: "ok" } } },
	];
	const older = [
		{ seq: 10, event: { type: "user/message", data: { text: "old" } } },
		{ seq: 20, event: { type: "user/message", data: { text: "new" } } },
	];
	const merged = mergeHistoryPage(existing, older);
	assert.equal(merged.length, 3);
	assert.equal(eventSeq(merged[0]), 10);
	assert.equal(eventSeq(merged[1]), 20);
	assert.equal(eventSeq(merged[2]), 21);
});

test("historyCursorFromResult exposes beforeSeq and hasMore", () => {
	const cursor = historyCursorFromResult(
		[
			{ seq: 5, event: { type: "user/message" } },
			{ seq: 9, event: { type: "assistant/message" } },
		],
		true,
	);
	assert.deepEqual(cursor, { beforeSeq: 5, hasMore: true });
});
