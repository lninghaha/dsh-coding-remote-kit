import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PushBridge } from "../lib/server/push-bridge.js";
import { createUpstreamHub } from "../lib/server/upstream.js";
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const aborted = (signal) => new Promise((resolve) => { if (signal.aborted) resolve(); else signal.addEventListener("abort", resolve, { once: true }); });
const drained = () => new Promise((resolve) => setImmediate(resolve));
const approval = { rpcId: "original-rpc", payload: { type: "approval/requested", sessionId: "S", approvalId: "approval-A", toolName: "private-tool", reason: "private-content" } };
const question = { rpcId: "question-rpc", payload: { type: "question/requested", sessionId: "S", questions: [{ id: "q", question: "question", options: [] }] } };
const push = { push: "approval.requested", rpcId: approval.rpcId, data: approval.payload };

test("offline startup and mux reopen restore pending original RPC ids, reset stale items, and deduplicate delivery", async () => {
 const directory = mkdtempSync(join(tmpdir(), "dshmr-inbox-"));
 const deliveries = [], initial = deferred(), replayed = deferred(), endFirst = deferred(), resolveItems = deferred(), resolved = deferred();
 let generation = 0, hub;
 const bridge = new PushBridge({ storageDirectory: directory, logger, hasActiveDevice: () => true,
  resolvePageUrl: () => "https://example.com/m/", onEnabled: () => hub?.start(),
  fetchImpl: async (url, request) => { deliveries.push({ url, request }); initial.resolve(); return { ok: true, status: 200 }; },
 });
 assert.equal(bridge.config.enabled, false);
 bridge.update({ enabled: true, provider: "ntfy", endpoint: "https://ntfy.sh/ignored-path", credential: "test-topic" });
 const api = { sessions: {}, respond: async () => ({ accepted: true }), events: {
  async *mux(_request, signal) {
   const current = ++generation;
   yield { rpcId: "subscribed", payload: { type: "session/subscribed", sessionId: "S", lastSeq: 1 } };
   yield approval; yield question;
   if (current === 1) { await Promise.race([endFirst.promise, aborted(signal)]); return; }
   await Promise.race([resolveItems.promise, aborted(signal)]);
   if (signal.aborted) return;
   yield { rpcId: "resolution", payload: { type: "approval/resolved", sessionId: "S", approvalId: "approval-A", outcome: "allowed-once" } };
   yield { rpcId: "question-resolution", payload: { type: "question/resolved", sessionId: "S", questionRpcId: "question-rpc", outcome: "answered" } };
   await aborted(signal);
  },
  async *host(_request, signal) { yield* []; await aborted(signal); },
 } };
 hub = createUpstreamHub(api, logger, { onApprovalRequested: (item) => bridge.notifyApprovalRequested(item), onApprovalResolved: (item) => bridge.forgetApproval(item) });
 try {
  // No mobile subscriber exists: stored opt-in starts observation after its carrier is ready.
  assert.equal(generation, 0);
  hub.start(); await initial.promise; await drained();
  assert.deepEqual(hub.pending().map((item) => item.rpcId).sort(), ["original-rpc", "question-rpc"]);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].url, "https://ntfy.sh/");
  const body = JSON.parse(deliveries[0].request.body);
  assert.equal(body.topic, "test-topic");
  assert.equal(new URL(body.click).searchParams.get("approvalId"), "approval-A");
  assert.equal(JSON.stringify(body).includes("private-content"), false);
  assert.equal(JSON.stringify(body).includes("private-tool"), false);
  const events = [];
  const subscriber = { host: false, sessionIds: new Set(["S"]), send(item) {
   events.push(item);
   if (generation > 1 && item.push === "question.requested") replayed.resolve();
   if (item.push === "question.resolved") resolved.resolve();
  } };
  hub.addSubscriber(subscriber); hub.subscribeHost(subscriber);
  const baseline = events.length;
  endFirst.resolve(); await replayed.promise; await drained();
  const rebuilt = events.slice(baseline);
  assert.equal(rebuilt[0].push, "inbox.reset");
  assert.equal(rebuilt.filter((item) => item.push === "approval.requested").length, 1);
  assert.equal(rebuilt.filter((item) => item.push === "question.requested").length, 1);
  assert.equal(deliveries.length, 1, "replayed request must not republish");
  assert.equal(hub.pending().find((item) => item.push === "approval.requested").rpcId, "original-rpc");
  resolveItems.resolve(); await resolved.promise;
  assert.deepEqual(hub.pending(), []);
  // A newly constructed bridge reads the same opt-in config after a host restart.
  const restarted = new PushBridge({ storageDirectory: directory, logger, hasActiveDevice: () => true, resolvePageUrl: () => "https://example.com/m/", fetchImpl: async () => { deliveries.push({ restart: true }); return { ok: true, status: 200 }; } });
  assert.equal(restarted.config.enabled, true);
  restarted.notifyApprovalRequested(push); await drained(); assert.equal(deliveries.length, 2);
 } finally { hub.stop(); endFirst.resolve(); resolveItems.resolve(); rmSync(directory, { recursive: true, force: true }); }
});

test("concurrent notifications share one attempt; explicit delivery failure permits a later replay attempt", async () => {
 const directory = mkdtempSync(join(tmpdir(), "dshmr-push-dedup-"));
 let attempts = 0; const first = deferred();
 const bridge = new PushBridge({ storageDirectory: directory, logger, hasActiveDevice: () => true, resolvePageUrl: () => "https://example.com/m/",
  fetchImpl: async () => { attempts++; return attempts === 1 ? first.promise : { ok: true, status: 200 }; },
 });
 try {
  bridge.update({ enabled: true, provider: "ntfy", endpoint: "https://ntfy.sh", credential: "test-topic" });
  bridge.notifyApprovalRequested(push); bridge.notifyApprovalRequested(push);
  assert.equal(attempts, 1);
  first.resolve({ ok: false, status: 503 }); await drained();
  bridge.notifyApprovalRequested(push); await drained();
  assert.equal(attempts, 2);
  bridge.notifyApprovalRequested(push); await drained(); assert.equal(attempts, 2);
 } finally { first.resolve({ ok: false, status: 503 }); rmSync(directory, { recursive: true, force: true }); }
});
