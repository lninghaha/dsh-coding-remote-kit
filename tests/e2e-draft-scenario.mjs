/** Serialized into the browser; every result comes from an observed action. */
export async function draftRecoveryScenario() {
 const fixture = globalThis.__dshmrDraftE2e, results = {};
 const observe = async (predicate, label) => {
  if (predicate()) return;
  await new Promise((resolve, reject) => {
   const observer = new MutationObserver(() => { if (predicate()) finish(); });
   // Existing CDP page-load deadline is also the failure watchdog here.
   const timer = setTimeout(() => { observer.disconnect(); reject(new Error(`Draft fixture: ${label}`)); }, 12_000);
   function finish() { clearTimeout(timer); observer.disconnect(); resolve(); }
   observer.observe(document.getElementById("app"), { subtree: true, childList: true, attributes: true, characterData: true });
   if (predicate()) finish();
  });
 };
 const check = (name, condition) => { results[name] = Boolean(condition); if (!condition) throw new Error(`Draft assertion: ${name}`); };
 const input = () => document.querySelector(".composer textarea");
 const settled = () => observe(() => document.querySelector('.composer button[type="submit"]')?.disabled === false, "send settled");
 const open = async (id) => {
  const back = [...document.querySelectorAll(".bar button")].find((button) => button.textContent === "Back");
  if (back) back.click();
  await observe(() => document.querySelector(".ws-toggle") !== null, "session list");
  if (!document.querySelector(".task")) document.querySelector(".ws-toggle").click();
  const task = [...document.querySelectorAll(".task")].find((node) => node.textContent.includes(`Fixture ${id}`));
  if (!task) throw new Error(`Missing task ${id}`);
  task.click();
  await observe(() => input() !== null && document.querySelector(".bar")?.textContent.includes(`Fixture ${id}`), `open ${id}`);
 };
 const edit = (value) => { const node = input(); if (!node) throw new Error("Missing composer"); node.value = value; node.dispatchEvent(new Event("input", { bubbles: true })); };
 const submit = () => { const before = fixture.promptCount(); document.querySelector(".composer").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); if (fixture.promptCount() !== before + 1) throw new Error("Prompt was not dispatched exactly once"); return fixture.latest(); };
 const mount = async (host, device = "device-a") => { fixture.mount({ host, device }); await observe(() => document.querySelector(".ws-toggle") !== null || input() !== null, "mounted"); };
 const reactions = () => new Promise((resolve) => queueMicrotask(() => queueMicrotask(resolve)));
 await mount("host-restored"); fixture.seed("A", "stored without editing"); await open("A");
 check("restoredWithoutEditing", input().value === "stored without editing");
 fixture.reply(submit()); await settled();
 check("ackClears", input().value === "" && fixture.draft("A") === null && fixture.marker("A") === null);
 edit("A in flight"); const editRequest = submit(); edit("B newer draft"); fixture.reply(editRequest); await settled();
 check("editBWhileAAck", input().value === "B newer draft" && fixture.draft("A") === "B newer draft");
 edit("rejected draft"); fixture.reply(submit(), "explicit rejection"); await settled();
 check("rejectPreserves", input().value === "rejected draft" && fixture.draft("A") === "rejected draft");
 check("rejectNoUnknown", fixture.marker("A") === null && !document.querySelector(".composer").textContent.includes("result is unknown"));
 edit("unknown draft"); submit(); fixture.disconnect(); await settled();
 const sentBeforeRestore = fixture.promptCount(); await mount("host-restored"); await open("A");
 check("unknownPreserves", input().value === "unknown draft" && fixture.marker("A") !== null && document.querySelector(".composer").textContent.includes("result is unknown"));
 check("noAutoRetry", fixture.promptCount() === sentBeforeRestore);
 await open("B"); check("isolatedSession", input().value === "" && fixture.draft("B") === null);
 await mount("host-other"); await open("A"); check("isolatedHost", input().value === "" && fixture.draft("A") === null);
 await mount("host-restored", "device-other"); await open("A"); check("isolatedDevice", input().value === "" && fixture.draft("A") === null);
 await mount("host-restored"); await open("A"); check("originalNamespaceRestored", input().value === "unknown draft");
 await mount("host-navigation"); await open("A"); edit("send from A"); const aRequest = submit();
 await open("B"); edit("B navigation draft"); fixture.reply(aRequest); await settled();
 check("navigationIsolation", input().value === "B navigation draft" && fixture.draft("B") === "B navigation draft");
 await open("A"); edit("A will fail"); const failedA = submit(); await open("B"); fixture.reply(failedA, "A-only error"); await reactions();
 check("navigationErrorIsolation", input().value === "B navigation draft" && !document.querySelector(".composer").textContent.includes("Send failed"));
 await mount("host-disposed"); await open("A"); edit("old instance"); const old = submit();
 await mount("host-disposed"); await open("A"); edit("new instance draft"); fixture.reply(old); await reactions();
 check("disposedIsolation", input().value === "new instance draft" && fixture.draft("A") === "new instance draft");
 fixture.dispose(); return results;
}
