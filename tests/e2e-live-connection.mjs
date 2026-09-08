/** Real WebSocket/E2EE mobile entrypoint in an isolated container. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nacl from "tweetnacl";
import { MobileDataPlane } from "../lib/server/dataplane.js";
import { DeviceRegistry, OfferRegistry, AuditLogger } from "../lib/server/registry.js";
import { ServerHandshake } from "../lib/server/e2ee.js";
import { base64Encode } from "../lib/shared/base64.js";
import { encodeOffer } from "../lib/shared/offer.js";
import { DEFAULT_OFFER_TTL_MS, MOBILE_PROTOCOL_VERSION } from "../lib/shared/constants.js";
import { historyPageSize } from "../lib/mobile/session-ui.js";
import { RendezvousClient } from "../lib/server/relay.js";
import { MockRendezvous } from "./mock-relay.mjs";
const logger = { debug() {}, info() {}, warn() {}, error() {} };

async function createFixture(mobileDir) {
 const directory = mkdtempSync(join(tmpdir(), "dshmr-browser-live-"));
 const registry = new DeviceRegistry(directory), offers = new OfferRegistry(), connections = new Set(), subscribers = new Set();
 const stats = { authenticated: 0, prompts: 0, lists: 0 };
 const promptResolvers = [];
 let promptStarted;
 const promptSeen = new Promise((resolve) => { promptStarted = resolve; });
 let keys = nacl.box.keyPair(), plane, incompatible = false, pendingRequests = [];
 const originalFinish = ServerHandshake.prototype.finish;
 ServerHandshake.prototype.finish = function (auth) {
  const result = originalFinish.call(this, auth);
  if (incompatible && result.ok) result.authenticated = { ...result.authenticated, minCompatibleMobileVersion: MOBILE_PROTOCOL_VERSION + 1 };
  return result;
 };
 const upstream = {
  addSubscriber(item) { subscribers.add(item); }, removeSubscriber(item) { subscribers.delete(item); },
  subscribeHost(item) { item.host = true; }, subscribeSession(item, id) { item.sessionIds.add(id); }, unsubscribeSession(item, id) { item.sessionIds.delete(id); }, pending() { return pendingRequests; },
  async list() { stats.lists++; return { ok: true, value: { items: [{ sessionId: "live", title: "Fixture Live", cwd: "/tmp/live-fixture", updatedAt: 1, blank: false, running: false }] } }; },
  async history() { return { ok: true, value: { events: Array.from({ length: historyPageSize() }, (_, index) => ({ seq: index + 1, event: { type: "assistant/message", data: { text: `Live message ${index + 1}\nReading position fixture.` } } })), hasMore: false } }; },
  prompt() { stats.prompts++; promptStarted(); return new Promise((resolve) => promptResolvers.push(resolve)); },
  async cancel() { return { ok: true, value: {} }; }, async respond() { return { ok: true, value: {} }; }, stop() {},
 };
 async function listen(port) {
  plane = new MobileDataPlane({ serverKeyPair: keys, registry, offers, audit: new AuditLogger(directory), logger, mobileDir, port, upstream });
  const deps = plane.connectionDeps.bind(plane);
  plane.connectionDeps = (address) => {
   const original = deps(address);
   return { ...original, onAuthenticated(id, connection) { original.onAuthenticated(id, connection); stats.authenticated++; connections.add(connection); }, onDisconnected(id, connection) { original.onDisconnected(id, connection); connections.delete(connection); } };
  };
  await plane.listen("127.0.0.1");
 }
 await listen(0);
 const relay = new MockRendezvous();
 const relayOrigin = await relay.listen();
 const rendezvous = new RendezvousClient({ persistFile: join(directory, "relay.json"), logger, offers, connectionDeps: () => plane.connectionDeps("relay") });
 await rendezvous.start({ origin: relayOrigin, hostToken: "test-host-token" });
 const base = () => `http://127.0.0.1:${plane.boundPort}/m/`;
 return {
  stats, promptSeen, base,
  pairCode() { return offers.createOffer({ endpoint: base().replace("http:", "ws:") + "ws", pageUrl: base(), publicKeyB64: base64Encode(keys.publicKey), ttlMs: DEFAULT_OFFER_TTL_MS }).pairCode; },
  pending(items) { pendingRequests = items; },
  async relayOfferUrl() {
   const invite = rendezvous.createInvite();
   const { offer } = offers.createOffer({ endpoint: rendezvous.advertise(invite).endpoint, pageUrl: base(), publicKeyB64: base64Encode(keys.publicKey), ttlMs: DEFAULT_OFFER_TTL_MS });
   await rendezvous.putInvite({ invite, expiresAt: offer.expiresAt, offerId: offer.offerId });
   return base() + "#" + encodeOffer(offer);
  },
  expireInvites() { for (const item of relay.invites.values()) item.expiresAt = Date.now() - 1; },
  offerUrl() { const { offer } = offers.createOffer({ endpoint: base().replace("http:", "ws:") + "ws", pageUrl: base(), publicKeyB64: base64Encode(keys.publicKey), ttlMs: DEFAULT_OFFER_TTL_MS }); return base() + "#" + encodeOffer(offer); },
  disconnect() { for (const connection of [...connections]) connection.close(1001, "fixture transport loss"); },
  revoke() { for (const device of registry.devices) if (device.revokedAt === undefined) plane.revokeDevice(device.deviceId); },
  async rotateKey() { const port = plane.boundPort; await plane.close(); keys = nacl.box.keyPair(); await listen(port); },
  incompatible() { incompatible = true; },
  async close() { await rendezvous.stop(); await relay.close(); await plane.close(); for (const resolve of promptResolvers) resolve({ ok: false, error: { code: "closed", message: "fixture closed" } }); ServerHandshake.prototype.finish = originalFinish; rmSync(directory, { recursive: true, force: true }); },
 };
}

export async function runLiveConnectionScenario(chrome, cdpOrigin, openCdp, mobileDir) {
 const fixture = await createFixture(mobileDir), results = {};
 const evaluate = async (expression) => {
  const response = await chrome.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result?.value;
 };
 const wait = (expression) => evaluate(`new Promise((resolve, reject) => {
  const check = () => (${expression}); if (check()) return resolve();
  const observer = new MutationObserver(() => { if (check()) finish(); });
  const timer = setTimeout(() => { observer.disconnect(); reject(new Error(${JSON.stringify(expression)})); }, 12000);
  function finish() { clearTimeout(timer); observer.disconnect(); resolve(); }
  observer.observe(document.body, { subtree: true, childList: true, attributes: true }); if (check()) finish();
 })`);
 const navigate = async (url) => { const loaded = chrome.wait("Page.loadEventFired", 12_000); const navigation = await chrome.send("Page.navigate", { url }); if (!navigation.loaderId) await chrome.send("Page.reload"); await loaded; };
 const check = (name, value) => { results[name] = Boolean(value); if (!value) throw new Error(`Live connection assertion: ${name}`); };
 const signals = `Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online"));`;
 try {
  await navigate(fixture.offerUrl());
  // --network none makes Chromium report offline despite the reachable loopback fixture.
  await evaluate('Object.defineProperty(navigator, "onLine", { configurable: true, value: true });');
  await wait('document.querySelector(".ws-toggle") !== null');
  await evaluate('document.querySelector(".ws-toggle").click(); document.querySelector(".task").click();');
  await wait('document.querySelector(".composer textarea") !== null');
  const savedTop = await evaluate(`(() => { const input = document.querySelector("textarea"); input.value = "tab draft"; input.dispatchEvent(new Event("input", { bubbles: true })); const node = document.querySelector(".transcript"); node.scrollTop = Math.floor((node.scrollHeight - node.clientHeight) / 2); node.dispatchEvent(new Event("scroll")); return node.scrollTop; })()`);
  const loaded = chrome.wait("Page.loadEventFired", 12_000); await chrome.send("Page.reload"); await loaded; await evaluate('Object.defineProperty(navigator, "onLine", { configurable: true, value: true });');
  await wait('document.querySelector(".composer textarea") !== null');
  check("realRefreshRestoresSessionDraftAndScroll", await evaluate(`document.querySelector(".bar").textContent.includes("Fixture Live") && document.querySelector("textarea").value === "tab draft" && document.querySelector(".transcript").scrollTop === ${savedTop}`));
  await evaluate('document.querySelector(".composer").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));');
  await fixture.promptSeen; fixture.disconnect();
  await wait('document.body.textContent.includes("Disconnected")');
  const beforeResume = fixture.stats.authenticated;
  await evaluate(signals); await wait('document.querySelector(".composer textarea") !== null');
  check("realNetworkResume", fixture.stats.authenticated === beforeResume + 1);
  check("uncertainSendNotRepeated", fixture.stats.prompts === 1 && await evaluate('document.querySelector("textarea").value === "tab draft" && document.querySelector(".composer").textContent.includes("result is unknown")'));
  const beforeVisible = fixture.stats.authenticated;
  await evaluate(`Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); delete document.visibilityState;`);
  await wait('document.querySelector(".composer textarea") !== null');
  check("foregroundEventResumesOnce", fixture.stats.authenticated === beforeVisible + 1);
  await evaluate('window.dispatchEvent(new Event("online")); document.dispatchEvent(new Event("visibilitychange"));');
  check("healthyEventsDoNotReconnect", fixture.stats.authenticated === beforeVisible + 1 && await evaluate('document.querySelector(".composer") !== null'));
  const target = await (await fetch(`${cdpOrigin}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" })).json();
  const other = await openCdp(target.webSocketDebuggerUrl);
  try {
   await other.send("Page.enable"); await other.send("Runtime.enable");
   fixture.pending([{ push: "approval.requested", rpcId: "live-approval-rpc", data: { sessionId: "live", approvalId: "click-target", toolName: "read" } }]);
   const otherLoaded = other.wait("Page.loadEventFired", 12_000); await other.send("Page.navigate", { url: fixture.base() + "?focus=approval&sessionId=live&approvalId=click-target" }); await otherLoaded;
   const page = await other.send("Runtime.evaluate", { expression: '({ pairing: document.querySelector("#pair-title") !== null, offer: sessionStorage.getItem("dshmr.offer"), focus: location.search.includes("approvalId=click-target") })', returnByValue: true });
   check("newTabRequiresPairingAndKeepsTarget", page.result.value.pairing && page.result.value.offer === null && page.result.value.focus);
   const paired = await other.send("Runtime.evaluate", { expression: `new Promise((resolve, reject) => {
    const check = () => { const card = document.querySelector('[data-approval-id="click-target"]'); return card && card.contains(document.activeElement) && card.querySelector("button") && !location.search.includes("approvalId="); };
    let frame;
    const poll = () => { if (check()) { clearTimeout(timer); resolve(true); } else frame = requestAnimationFrame(poll); };
    const timer = setTimeout(() => { cancelAnimationFrame(frame); reject(new Error("notification pairing did not restore actionable target: " + JSON.stringify({ active: document.activeElement?.outerHTML, search: location.search }))); }, 12000);
    frame = requestAnimationFrame(poll);
    const input = document.querySelector("#pair-code"); input.value = ${JSON.stringify(fixture.pairCode())}; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
   })`, awaitPromise: true, returnByValue: true });
   if (paired.exceptionDetails) throw new Error(paired.exceptionDetails.exception?.description ?? paired.exceptionDetails.text);
   check("notificationRePairRestoresActionableTarget", paired.result.value);
  } finally { other.close(); await fetch(`${cdpOrigin}/json/close/${target.id}`); }
  await navigate(await fixture.relayOfferUrl()); await wait('document.querySelector(".ws-toggle") !== null');
  fixture.expireInvites();
  const relayReload = chrome.wait("Page.loadEventFired", 12_000); await chrome.send("Page.reload"); await relayReload;
  await wait('document.querySelector(".ws-toggle") !== null');
  check("expiredRelayInviteResumesAfterRefresh", await evaluate('JSON.parse(sessionStorage.getItem("dshmr.offer")).endpoint.includes("resume=1")'));
  fixture.disconnect(); await wait('document.body.textContent.includes("Disconnected")');
  const manualCount = fixture.stats.authenticated;
  await evaluate('[...document.querySelectorAll("button")].find(node => node.textContent === "Retry connection").click()');
  await wait('document.querySelector(".ws-toggle") !== null');
  check("expiredRelayInviteManualRetry", fixture.stats.authenticated === manualCount + 1);
  fixture.disconnect(); await wait('document.body.textContent.includes("Disconnected")');
  const relayCount = fixture.stats.authenticated; await evaluate(signals); await wait('document.querySelector(".ws-toggle") !== null');
  check("expiredRelayInviteResumesAfterNetworkLoss", fixture.stats.authenticated === relayCount + 1);
  fixture.revoke(); await wait('document.body.textContent.includes("Device permission expired")');
  const deniedCount = fixture.stats.authenticated; await evaluate(signals);
  check("revokedDoesNotAutoRetry", deniedCount === fixture.stats.authenticated && await evaluate('document.body.textContent.includes("Device permission expired")'));
  await navigate(fixture.offerUrl()); await wait('document.querySelector(".ws-toggle") !== null');
  await fixture.rotateKey(); await wait('document.body.textContent.includes("Disconnected")');
  await evaluate(signals); await wait('document.body.textContent.includes("Server public key does not match")');
  await evaluate(signals); check("keyMismatchStaysTerminal", await evaluate('document.body.textContent.includes("Server public key does not match")'));
  fixture.incompatible(); const listed = fixture.stats.lists;
  await navigate(fixture.offerUrl()); await wait('document.body.textContent.includes("Version too old")');
  await evaluate(signals);
  check("authenticatedVersionFailsClosed", fixture.stats.lists === listed && await evaluate('document.body.textContent.includes("Version too old") && document.querySelector(".composer") === null'));
  const manifestStatus = await evaluate('fetch("/m/manifest.webmanifest").then((response) => response.status)');
  return { ...results, manifestStatus };
 } catch (error) {
  console.error("live-fixture failure", Object.keys(results), fixture.stats, await evaluate('({ online: navigator.onLine, visibility: document.visibilityState, notice: document.querySelector(".notice-card h2")?.textContent })'));
  throw error;
 } finally { await fixture.close(); }
}
