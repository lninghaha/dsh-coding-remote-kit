/** Use the browser suite's existing 12s navigation deadline and 100ms poll. */
export async function waitForCdp(origin, fetcher = fetch) {
 const deadline = Date.now() + 12_000;
 let lastError;
 while (Date.now() < deadline) {
  try {
   const response = await fetcher(`${origin}/json/version`, { signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
   if (response.ok && typeof (await response.json()).webSocketDebuggerUrl === "string") return;
   lastError = new Error("Chrome CDP version endpoint is not ready");
  } catch (error) { lastError = error; }
  await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(0, deadline - Date.now()))));
 }
 throw new Error("Chrome CDP startup deadline exceeded", { cause: lastError });
}
