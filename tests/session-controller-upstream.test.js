import assert from "node:assert/strict";
import test from "node:test";
import { registerInteractionAnswerers } from "../lib/server/approval-bridge.js";
import { dispatchRpc } from "../lib/server/rpc.js";
import { createSessionControllerUpstream, isSessionController } from "../lib/server/session-controller-upstream.js";

function silentLogger() {
	return { debug() {}, info() {}, warn() {}, error() {} };
}

function abortWait(signal) {
	return new Promise((resolve) => {
		if (signal.aborted) {
			resolve();
			return;
		}
		signal.addEventListener("abort", () => resolve(), { once: true });
	});
}

async function waitUntil(predicate, timeoutMs = 2000) {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

function eventOf(seq, type = "user/message") {
	return { type, seq, time: 1_000 + seq, data: { seq } };
}

function createFakeController() {
	const queue = [];
	let waiter = null;
	const calls = { list: 0, inspect: 0, page: [], prompt: [], cancel: [], create: [], follow: [] };
	return {
		calls,
		push(frame) {
			queue.push(frame);
			const resume = waiter;
			waiter = null;
			resume?.();
		},
		async list(_request, _signal) {
			calls.list += 1;
			return {
				items: [
					{
						sessionId: "sess-1",
						updatedAt: 2000,
						running: false,
						blank: false,
						cwd: "/tmp",
						projections: { asOfSeq: 5, values: { title: "Mobile ready" } },
					},
					{ sessionId: "sess-blank", updatedAt: 100, running: false, blank: true },
				],
			};
		},
		async inspect(_sessionId, _signal) {
			calls.inspect += 1;
			return { events: [eventOf(4), eventOf(5)] };
		},
		async page(request, _signal) {
			calls.page.push(request);
			return {
				records: [
					{ type: "event", event: eventOf(4) },
					{ type: "event", event: eventOf(5) },
				],
				hasMore: false,
			};
		},
		async *follow(_request, signal) {
			calls.follow.push(_request);
			yield {
				type: "snapshot",
				header: { version: 1, id: "sess-1", createdAt: 0, isSeeded: false },
				cursor: 5,
				records: [
					{ type: "event", event: eventOf(4) },
					{ type: "event", event: eventOf(5) },
				],
				hasMore: false,
				projections: { asOfSeq: 5, values: {} },
			};
			while (!signal.aborted) {
				if (queue.length > 0) {
					yield queue.shift();
					continue;
				}
				await new Promise((resolve) => {
					waiter = resolve;
				});
			}
		},
		async prompt(request, _signal) {
			calls.prompt.push(request);
			return { accepted: true };
		},
		cancel(request) {
			calls.cancel.push(request);
			return { accepted: true };
		},
		async create(request) {
			calls.create.push(request);
			return { sessionId: "sess-new" };
		},
	};
}

function subscriberOf(pushes) {
	return {
		send(push) {
			pushes.push(push);
		},
		sessionIds: new Set(),
		host: false,
	};
}

function rpcContext(hub, subscriber) {
	return {
		upstream: hub,
		connection: {
			subscribeSession(sessionId) {
				hub.subscribeSession(subscriber, sessionId);
			},
			unsubscribeSession(sessionId) {
				hub.unsubscribeSession(subscriber, sessionId);
			},
			subscribeHost() {
				hub.subscribeHost(subscriber);
			},
		},
	};
}

test("sessionController detection accepts the 0.1.5 service and rejects partial shapes", () => {
	const controller = createFakeController();
	assert.equal(isSessionController(controller), true);
	assert.equal(isSessionController({ ...controller, follow: undefined }), false);
	assert.equal(isSessionController(undefined), false);
	assert.equal(isSessionController({}), false);
});

test("session list maps summaries and hides blank sessions", async () => {
	const controller = createFakeController();
	const hub = createSessionControllerUpstream(controller, silentLogger());
	const listed = await dispatchRpc({ id: 1, method: "session.list", params: {} }, { upstream: hub });
	assert.equal(listed.ok, true);
	assert.equal(listed.result.items.length, 1);
	assert.equal(listed.result.items[0].sessionId, "sess-1");
	assert.equal(listed.result.items[0].title, "Mobile ready");
	assert.equal(listed.result.items[0].cwd, "/tmp");
	assert.equal(controller.calls.list, 1);
	hub.stop();
});

test("history reads a cold page without activating the session", async () => {
	const controller = createFakeController();
	const hub = createSessionControllerUpstream(controller, silentLogger());
	const history = await dispatchRpc(
		{ id: 1, method: "session.history", params: { sessionId: "sess-1", maxMessages: 20 } },
		{ upstream: hub },
	);
	assert.equal(history.ok, true);
	assert.equal(controller.calls.inspect, 1);
	assert.equal(controller.calls.follow.length, 0);
	assert.equal(controller.calls.page.length, 1);
	assert.equal(controller.calls.page[0].throughSeq, 5);
	assert.equal(controller.calls.page[0].beforeSeq, undefined);
	assert.equal(history.result.events.length, 2);
	assert.equal(history.result.events[1].seq, 5);
	hub.stop();
});

test("history pages backwards from the phone cursor", async () => {
	const controller = createFakeController();
	const hub = createSessionControllerUpstream(controller, silentLogger());
	await dispatchRpc(
		{ id: 1, method: "session.history", params: { sessionId: "sess-1", maxMessages: 20 } },
		{ upstream: hub },
	);
	await dispatchRpc(
		{ id: 2, method: "session.history", params: { sessionId: "sess-1", maxMessages: 20, beforeSeq: 4 } },
		{ upstream: hub },
	);
	assert.equal(controller.calls.page.length, 2);
	assert.equal(controller.calls.page[1].beforeSeq, 4);
	// The inspected cursor is reused; a cold second read does not re-inspect.
	assert.equal(controller.calls.inspect, 1);
	hub.stop();
});

test("live events reach a subscriber exactly once across history and subscribe", async () => {
	const controller = createFakeController();
	const hub = createSessionControllerUpstream(controller, silentLogger());
	const pushes = [];
	const subscriber = subscriberOf(pushes);
	hub.addSubscriber(subscriber);
	await dispatchRpc(
		{ id: 1, method: "session.history", params: { sessionId: "sess-1", maxMessages: 20 } },
		rpcContext(hub, subscriber),
	);
	await dispatchRpc({ id: 2, method: "session.subscribe", params: { sessionId: "sess-1" } }, rpcContext(hub, subscriber));
	await waitUntil(() => controller.calls.follow.length === 1);
	assert.equal(pushes.filter((push) => push.push === "session.event").length, 0);
	controller.push({ type: "event", event: eventOf(6) });
	await waitUntil(() => pushes.some((push) => push.push === "session.event"));
	const delivered = pushes.filter((push) => push.push === "session.event");
	assert.equal(delivered.length, 1);
	assert.equal(delivered[0].data.sessionId, "sess-1");
	assert.equal(delivered[0].data.event.seq, 6);
	hub.stop();
});

test("subscribing without history starts from the snapshot cursor", async () => {
	const controller = createFakeController();
	const hub = createSessionControllerUpstream(controller, silentLogger());
	const pushes = [];
	const subscriber = subscriberOf(pushes);
	hub.addSubscriber(subscriber);
	await dispatchRpc({ id: 1, method: "session.subscribe", params: { sessionId: "sess-1" } }, rpcContext(hub, subscriber));
	await waitUntil(() => controller.calls.follow.length === 1);
	assert.equal(pushes.filter((push) => push.push === "session.event").length, 0);
	controller.push({ type: "event", event: eventOf(7) });
	await waitUntil(() => pushes.some((push) => push.push === "session.event"));
	assert.equal(pushes.find((push) => push.push === "session.event").data.event.seq, 7);
	hub.stop();
});

test("assistant text deltas stream as assistant/chunk pushes", async () => {
	const controller = createFakeController();
	const hub = createSessionControllerUpstream(controller, silentLogger());
	const pushes = [];
	const subscriber = subscriberOf(pushes);
	hub.addSubscriber(subscriber);
	await dispatchRpc({ id: 1, method: "session.subscribe", params: { sessionId: "sess-1" } }, rpcContext(hub, subscriber));
	await waitUntil(() => controller.calls.follow.length === 1);
	controller.push({
		type: "assistant-stream",
		frame: { type: "chunk", attemptId: "a-1", revision: 1, index: 3, time: 42, chunk: { type: "text-delta", index: 0, text: "hello" } },
	});
	await waitUntil(() => pushes.some((push) => push.push === "session.event"));
	const streamed = pushes.find((push) => push.push === "session.event");
	assert.equal(streamed.data.event.type, "assistant/chunk");
	assert.equal(streamed.data.event.data.text, "hello");
	hub.stop();
});

test("approval asks reach the phone and settle through respond", async () => {
	const controller = createFakeController();
	const hub = createSessionControllerUpstream(controller, silentLogger());
	const pushes = [];
	const subscriber = subscriberOf(pushes);
	hub.addSubscriber(subscriber);
	hub.subscribeSession(subscriber, "sess-1");
	const handle = hub.interactions.askApproval({
		sessionId: "sess-1",
		approvalId: "appr-1",
		toolName: "bash",
		reason: "run command",
	});
	await waitUntil(() => pushes.some((push) => push.push === "approval.requested"));
	const request = pushes.find((push) => push.push === "approval.requested");
	assert.equal(request.data.sessionId, "sess-1");
	assert.equal(request.data.approvalId, "appr-1");
	assert.equal(request.data.toolName, "bash");
	const answered = await dispatchRpc(
		{
			id: 3,
			method: "respond",
			params: { rpcId: request.rpcId, sessionId: "sess-1", approvalId: "appr-1", outcome: "allowed-once" },
		},
		{ upstream: hub },
	);
	assert.equal(answered.ok, true);
	assert.equal(await handle.settled, "allowed-once");
	assert.equal(pushes.some((push) => push.push === "approval.resolved"), true);
	hub.stop();
});

test("an unknown or mismatched respond is rejected as not-pending", async () => {
	const controller = createFakeController();
	const hub = createSessionControllerUpstream(controller, silentLogger());
	const pushes = [];
	const subscriber = subscriberOf(pushes);
	hub.addSubscriber(subscriber);
	hub.subscribeSession(subscriber, "sess-1");
	const handle = hub.interactions.askApproval({ sessionId: "sess-1", approvalId: "appr-1", toolName: "bash" });
	await waitUntil(() => pushes.some((push) => push.push === "approval.requested"));
	const request = pushes.find((push) => push.push === "approval.requested");
	const mismatched = await dispatchRpc(
		{
			id: 4,
			method: "respond",
			params: { rpcId: request.rpcId, sessionId: "sess-1", approvalId: "other", outcome: "rejected" },
		},
		{ upstream: hub },
	);
	assert.equal(mismatched.ok, false);
	assert.equal(mismatched.error.message, "not-pending");
	handle.abandon();
	assert.equal(await handle.settled, "cancelled");
	hub.stop();
});

test("pending cards replay to a reconnecting subscriber", async () => {
	const controller = createFakeController();
	const hub = createSessionControllerUpstream(controller, silentLogger());
	const first = subscriberOf([]);
	hub.addSubscriber(first);
	hub.subscribeSession(first, "sess-1");
	const handle = hub.interactions.askApproval({ sessionId: "sess-1", approvalId: "appr-1", toolName: "bash" });
	await waitUntil(() => hub.interactions.hasPending("sess-1"));
	const pushes = [];
	const reconnected = subscriberOf(pushes);
	hub.addSubscriber(reconnected);
	hub.subscribeSession(reconnected, "sess-1");
	assert.equal(pushes.filter((push) => push.push === "approval.requested").length, 1);
	handle.abandon();
	await handle.settled;
	hub.stop();
});

test("approval requests also feed the offline push hook", async () => {
	const controller = createFakeController();
	const seen = [];
	const hub = createSessionControllerUpstream(controller, silentLogger(), {
		onApprovalRequested: (push) => seen.push(push),
	});
	hub.addSubscriber(subscriberOf([]));
	const handle = hub.interactions.askApproval({ sessionId: "sess-1", approvalId: "appr-1", toolName: "bash" });
	await waitUntil(() => seen.length === 1);
	assert.equal(seen[0].push, "approval.requested");
	assert.equal(seen[0].data.approvalId, "appr-1");
	handle.abandon();
	await handle.settled;
	hub.stop();
});

test("the approval bridge delegates without a watching phone", async () => {
	const controller = createFakeController();
	const hub = createSessionControllerUpstream(controller, silentLogger());
	const listeners = new Map();
	const host = {
		on(name, listener) {
			listeners.set(name, listener);
			return () => listeners.delete(name);
		},
	};
	const dispose = registerInteractionAnswerers({ host, hub, logger: silentLogger() });
	const answer = await listeners.get("approval/request")({ agent: { id: "sess-1" }, toolName: "bash" }, async () => "unavailable");
	assert.equal(answer, "unavailable");
	assert.equal(hub.interactions.size, 0);
	dispose();
	hub.stop();
});

test("the approval bridge claims a request while a phone watches", async () => {
	const controller = createFakeController();
	const hub = createSessionControllerUpstream(controller, silentLogger());
	const listeners = new Map();
	const host = {
		on(name, listener) {
			listeners.set(name, listener);
			return () => listeners.delete(name);
		},
	};
	registerInteractionAnswerers({ host, hub, logger: silentLogger() });
	const pushes = [];
	const subscriber = subscriberOf(pushes);
	hub.addSubscriber(subscriber);
	hub.subscribeSession(subscriber, "sess-1");
	const answered = listeners.get("approval/request")({ agent: { id: "sess-1" }, toolName: "bash" }, async () => "unavailable");
	await waitUntil(() => pushes.some((push) => push.push === "approval.requested"));
	const request = pushes.find((push) => push.push === "approval.requested");
	const receipt = await dispatchRpc(
		{
			id: 5,
			method: "respond",
			params: { rpcId: request.rpcId, sessionId: "sess-1", approvalId: request.data.approvalId, outcome: "allowed-once" },
		},
		{ upstream: hub },
	);
	assert.equal(receipt.ok, true);
	assert.equal(await answered, "allowed-once");
	hub.stop();
});

test("the approval bridge prefers a composed chain decision and retires the card", async () => {
	const controller = createFakeController();
	const hub = createSessionControllerUpstream(controller, silentLogger());
	const listeners = new Map();
	const host = {
		on(name, listener) {
			listeners.set(name, listener);
			return () => listeners.delete(name);
		},
	};
	registerInteractionAnswerers({ host, hub, logger: silentLogger() });
	const pushes = [];
	const subscriber = subscriberOf(pushes);
	hub.addSubscriber(subscriber);
	hub.subscribeSession(subscriber, "sess-1");
	const answer = await listeners.get("approval/request")({ agent: { id: "sess-1" }, toolName: "bash" }, async () => "rejected");
	assert.equal(answer, "rejected");
	assert.equal(pushes.some((push) => push.push === "approval.resolved"), true);
	assert.equal(hub.interactions.size, 0);
	hub.stop();
});

test("user questions are answered through the phone", async () => {
	const controller = createFakeController();
	const hub = createSessionControllerUpstream(controller, silentLogger());
	const listeners = new Map();
	const host = {
		on(name, listener) {
			listeners.set(name, listener);
			return () => listeners.delete(name);
		},
	};
	registerInteractionAnswerers({ host, hub, logger: silentLogger() });
	const pushes = [];
	const subscriber = subscriberOf(pushes);
	hub.addSubscriber(subscriber);
	hub.subscribeSession(subscriber, "sess-1");
	const answered = listeners.get("user-questions/request")(
		{ agent: { id: "sess-1" }, questions: [{ id: "q1", question: "Pick one", options: [{ label: "A" }, { label: "B" }] }] },
		async () => {
			throw new Error("no answerer");
		},
	);
	await waitUntil(() => pushes.some((push) => push.push === "question.requested"));
	const request = pushes.find((push) => push.push === "question.requested");
	const receipt = await dispatchRpc(
		{
			id: 6,
			method: "respond",
			params: { rpcId: request.rpcId, sessionId: "sess-1", answers: [{ id: "q1", selected: ["A"] }] },
		},
		{ upstream: hub },
	);
	assert.equal(receipt.ok, true);
	assert.deepEqual(await answered, { answers: [{ id: "q1", selected: ["A"] }] });
	hub.stop();
});

test("host session events mirror to host subscribers only", async () => {
	const controller = createFakeController();
	const listeners = new Map();
	const host = {
		on(name, listener) {
			listeners.set(name, listener);
			return () => listeners.delete(name);
		},
	};
	const hub = createSessionControllerUpstream(controller, silentLogger(), { hostEvents: host });
	const pushes = [];
	const subscriber = subscriberOf(pushes);
	hub.addSubscriber(subscriber);
	hub.subscribeHost(subscriber);
	listeners.get("api-session/added")({ sessionId: "sess-9", blank: false, cwd: "/work" });
	listeners.get("api-session/status")("sess-9", true);
	listeners.get("api-session/removed")("sess-9");
	assert.deepEqual(
		pushes.map((push) => push.data.type),
		["host/session-added", "host/session-status", "host/session-removed"],
	);
	assert.equal(pushes[2].data.sessionId, "sess-9");
	hub.stop();
});

test("prompt / cancel / create map onto the sessionController contract", async () => {
	const controller = createFakeController();
	const hub = createSessionControllerUpstream(controller, silentLogger());
	const prompted = await dispatchRpc(
		{ id: 7, method: "session.prompt", params: { sessionId: "sess-1", text: "hello" } },
		{ upstream: hub },
	);
	assert.equal(prompted.ok, true);
	assert.equal(controller.calls.prompt.length, 1);
	assert.equal(controller.calls.prompt[0].sessionId, "sess-1");
	assert.equal(controller.calls.prompt[0].mode, "queue");
	assert.equal(typeof controller.calls.prompt[0].requestId, "string");
	assert.deepEqual(controller.calls.prompt[0].content, [{ type: "text", text: "hello" }]);
	const cancelled = await dispatchRpc(
		{ id: 8, method: "session.cancel", params: { sessionId: "sess-1" } },
		{ upstream: hub },
	);
	assert.equal(cancelled.ok, true);
	assert.deepEqual(controller.calls.cancel[0], { sessionId: "sess-1" });
	const created = await dispatchRpc({ id: 9, method: "session.create", params: {} }, { upstream: hub });
	assert.equal(created.ok, true);
	assert.equal(created.result.sessionId, "sess-new");
	hub.stop();
});

test("upstream failures fold to upstream_error without leaking details", async () => {
	const controller = {
		...createFakeController(),
		async list() {
			throw new Error("session not found");
		},
	};
	const hub = createSessionControllerUpstream(controller, silentLogger());
	const listed = await dispatchRpc({ id: 1, method: "session.list", params: {} }, { upstream: hub });
	assert.equal(listed.ok, false);
	assert.equal(listed.error.code, "upstream_error");
	assert.equal(listed.error.message, "session not found");
	assert.equal(JSON.stringify(listed).includes("details"), false);
	hub.stop();
});

test("a hub without the controller reports the backend as unavailable", async () => {
	const hub = createSessionControllerUpstream(undefined, silentLogger());
	const listed = await dispatchRpc({ id: 1, method: "session.list", params: {} }, { upstream: hub });
	assert.equal(listed.ok, false);
	assert.equal(listed.error.message, "sessionController is unavailable");
	hub.stop();
});
