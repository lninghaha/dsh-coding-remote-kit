/** Test-only browser entry: real app/RPC with an explicitly controlled host. */
import { MobileRpcClient } from "../src/mobile/rpc.ts";
import { startConnectedApp } from "../src/mobile/app.ts";
import { sessionUiKey } from "../src/mobile/persist.ts";
import { historyPageSize } from "../src/mobile/session-ui.ts";
const root = document.getElementById("app");
const calls = [], pending = new Map();
const histories = new Map(), heldHistory = [], historyCalls = [], replies = [];
let holdOlder = false, holdNextHistory = false, inbox = [], focusConsumed = 0, holdBaseline = false, baselineReply;
let generation = 0, dispose = () => {}, current;
const sessions = ["A", "B"].map((sessionId) => ({ sessionId, title: `Fixture ${sessionId}`, cwd: "/tmp/draft-fixture", running: false, blank: false, updatedAt: 1 }));
function mount({ host = "host-a", device = "device-a", focus = null } = {}) {
 dispose();
 const clientGeneration = ++generation;
 const rpc = new MobileRpcClient((request) => {
  if (request.method === "session.prompt") {
   const key = `${clientGeneration}:${request.id}`;
   calls.push({ key, request }); pending.set(key, { rpc, request, generation: clientGeneration }); return;
  }
  let result;
  switch (request.method) {
   case "host.subscribe":
    if (holdBaseline) { holdBaseline = false; baselineReply = (snapshot) => rpc.handleMessage({ id: request.id, ok: true, result: { accepted: true, pending: snapshot } }); return; }
    result = inbox === null ? { accepted: true } : { accepted: true, pending: inbox }; break;
   case "session.list": result = { items: sessions }; break;
   case "session.history": {
    historyCalls.push(request.params);
    const available = (histories.get(request.params.sessionId) ?? []).filter((row) => request.params.beforeSeq === undefined || row.seq < request.params.beforeSeq);
    const size = request.params.maxMessages ?? available.length;
    result = { events: available.slice(-size), hasMore: available.length > size };
    if (holdNextHistory || (holdOlder && request.params.beforeSeq !== undefined)) { holdNextHistory = false; holdOlder = false; heldHistory.push({ rpc, request, result }); return; }
    break;
   }
   case "respond": replies.push(request.params); result = { accepted: true }; break;
   case "session.subscribe": case "session.unsubscribe": result = { accepted: true }; break;
   default: throw new Error(`Unhandled fixture method: ${request.method}`);
  }
  rpc.handleMessage({ id: request.id, ok: true, result });
 });
 current = { rpc, host, device, generation: clientGeneration };
 dispose = startConnectedApp(root, rpc, { hostPublicKeyB64: host, deviceId: device, storage: sessionStorage, focusApproval: focus, onApprovalFocusConsumed: () => { focusConsumed++; } });
}
const keyFor = (sessionId) => sessionUiKey(current.host, current.device, sessionId, "draft");
globalThis.__dshmrDraftE2e = {
 mount, pageSize: historyPageSize(),
 setHistory(id, events) { histories.set(id, events); }, historyCalls,
 holdOlder() { holdOlder = true; }, historyPending() { return heldHistory.length; },
 holdHistory() { holdNextHistory = true; },
 releaseHistory(error) { const item = heldHistory.shift(); if (!item) throw new Error("No held page"); item.rpc.handleMessage(error ? { id: item.request.id, ok: false, error: { code: "upstream_error", message: error } } : { id: item.request.id, ok: true, result: item.result }); },
 setInbox(value) { inbox = value; }, replies,
 push(value) { current.rpc.handleMessage(value); },
 consumed() { return focusConsumed; },
 holdBaseline() { holdBaseline = true; }, releaseBaseline(value) { baselineReply(value); },
 seed(sessionId, value) { sessionStorage.setItem(keyFor(sessionId), value); },
 draft(sessionId) { return sessionStorage.getItem(keyFor(sessionId)); },
 marker(sessionId) { return sessionStorage.getItem(`${keyFor(sessionId)}.pending`); },
 promptCount() { return calls.length; }, latest() { return calls.at(-1)?.key; },
 reply(key, error) {
  const item = pending.get(key); if (!item) throw new Error(`Missing pending ${key}`);
  pending.delete(key);
  item.rpc.handleMessage(error === undefined ? { id: item.request.id, ok: true, result: { accepted: true } } : { id: item.request.id, ok: false, error: { code: "forbidden", message: error } });
 },
 disconnect() {
  for (const [key, item] of pending) if (item.generation === current.generation) pending.delete(key);
  current.rpc.failAll("disconnected");
 },
 dispose() { dispose(); },
};
mount();
