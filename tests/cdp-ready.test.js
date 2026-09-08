import assert from "node:assert/strict";
import test from "node:test";
import { waitForCdp } from "./e2e-cdp-ready.mjs";

test("CDP startup waits through a refused connection and an incomplete endpoint", async () => {
 let attempts = 0;
 await waitForCdp("http://127.0.0.1:9222", async (_url, options) => {
  assert.ok(options.signal instanceof AbortSignal);
  attempts++;
  if (attempts === 1) throw new Error("ECONNREFUSED");
  return { ok: true, json: async () => attempts === 2 ? {} : { webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/fixture" } };
 });
 assert.equal(attempts, 3);
});
