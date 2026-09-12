// 浏览器行为回归使用受控 RPC；真实宿主/Go 验收另行记录，不能相互替代。
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const source = (await readFile(new URL("../src/mobile/app.ts", import.meta.url), "utf8")).replace(
	"const disposePush = rpc.onPush(handlePush);",
	"globalThis.__testApp = { loadSession, leaveSession, state }; const disposePush = rpc.onPush(handlePush);",
);
const bundle = await build({
	stdin: {
		contents: source + "\nglobalThis.startTestApp = startConnectedApp;",
		resolveDir: root + "src/mobile",
		loader: "ts",
	},
	bundle: true,
	write: false,
	format: "iife",
	platform: "browser",
});
const shell = await readFile(new URL("../src/mobile/index.html", import.meta.url), "utf8");
const out = root + "output/playwright/review071-behavior";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	viewport: { width: 390, height: 844 },
	deviceScaleFactor: 3,
	isMobile: true,
	hasTouch: true,
});
const page = await context.newPage();
const evidence = { kind: "controlled-rpc-browser-regression", passed: [], screenshots: [] };
try {
	await page.route("http://mobile-test.invalid/", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">${shell.match(/<style>[\s\S]*?<\/style>/)?.[0] ?? ""}</head><body><div id="app"></div></body></html>`,
		}),
	);
	await page.goto("http://mobile-test.invalid/");
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	await page.evaluate(() => {
		globalThis.calls = [];
		globalThis.historyReplies = [];
		const rpc = {
			onPush(fn) {
				globalThis.push = fn;
				return () => {};
			},
			async request(method, params) {
				calls.push({ method, params });
				if (method === "session.list") return { items: [] };
				if (method === "session.history")
					return await new Promise((resolve, reject) => historyReplies.push({ resolve, reject }));
				return { accepted: true };
			},
		};
		globalThis.disposeApp = startTestApp(document.querySelector("#app"), rpc);
	});
	const history = await page.evaluate(async () => {
		const load = __testApp.loadSession("a");
		await Promise.resolve();
		await Promise.resolve();
		const ev = (seq, type, text) => ({ sessionId: "a", event: { seq, type, data: { text } } });
		push({ push: "session.event", data: ev(1, "user/message", "hello") });
		push({ push: "session.event", data: ev(1, "assistant/chunk", "one") });
		push({ push: "session.event", data: ev(1, "assistant/chunk", "two") });
		historyReplies
			.shift()
			.resolve({ events: [{ seq: 1, type: "user/message", data: { text: "hello" } }], hasMore: false });
		await load;
		return {
			types: __testApp.state.events.map((e) => (e.event ?? e).type),
			order: calls.filter((c) => c.method.startsWith("session.")).map((c) => c.method),
		};
	});
	assert.deepEqual(history.types, ["user/message", "assistant/chunk", "assistant/chunk"]);
	assert.ok(history.order.indexOf("session.subscribe") < history.order.indexOf("session.history"));
	evidence.passed.push("subscribe before history; buffered durable dedupe; same-seq chunks preserved");
	assert.deepEqual(
		await page.evaluate(async () => {
			const load = __testApp.loadSession("b");
			await Promise.resolve();
			await Promise.resolve();
			historyReplies.shift().reject(new Error("read failed"));
			try {
				await load;
			} catch {}
			return { session: __testApp.state.view.sessionId, events: __testApp.state.events.length };
		}),
		{ session: "a", events: 3 },
	);
	evidence.passed.push("failed history retains current task and messages");
	assert.equal(
		await page.evaluate(async () => {
			const load = __testApp.loadSession("b");
			await Promise.resolve();
			await Promise.resolve();
			await __testApp.leaveSession();
			historyReplies.shift().resolve({ events: [{ seq: 9 }], hasMore: false });
			await load;
			return __testApp.state.view.name;
		}),
		"list",
	);
	evidence.passed.push("leaving while loading discards stale history");
	await page.evaluate(() =>
		push({
			push: "question.requested",
			rpcId: "plan",
			data: {
				sessionId: "a",
				questions: [
					{
						id: "q",
						question: "Review the plan",
						detail:
							"# Complete plan\n\nRead the file and explain the result.\n\n<script>globalThis.injected=true</script>",
						intent: { kind: "plan-review", approve: "Approve" },
						options: [{ label: "Approve" }, { label: "Reject" }],
					},
				],
			},
		}),
	);
	await page.locator(".question-detail").waitFor();
	assert.match(await page.locator(".question-detail").innerText(), /Complete plan/);
	assert.equal(await page.evaluate(() => globalThis.injected === true), false);
	for (const size of [
		{ width: 390, height: 844 },
		{ width: 844, height: 390 },
		{ width: 390, height: 500 },
	]) {
		await page.setViewportSize(size);
		await page.locator("form.card button[type=submit]").scrollIntoViewIfNeeded();
		const metrics = await page.evaluate(() => ({
			css: [innerWidth, innerHeight],
			dpr: devicePixelRatio,
			horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
		}));
		assert.equal(metrics.horizontalOverflow, false);
		const path = `${out}/plan-${size.width}-${size.height}.png`;
		const image = await page.screenshot({ path });
		evidence.screenshots.push({ ...metrics, pixels: [image.readUInt32BE(16), image.readUInt32BE(20)] });
	}
	await page.locator('input[value="Reject"]').check();
	await page.evaluate(() =>
		push({ push: "host.event", data: { type: "host/session-status", sessionId: "a", running: true } }),
	);
	assert.equal(await page.locator('input[value="Reject"]').isChecked(), true);
	assert.equal(await page.locator('input[value="Reject"]').evaluate((input) => input === document.activeElement), true);
	evidence.passed.push("complete safe markdown, viewport layout, choice survives background render");
	await page.evaluate(() => push({ push: "question.resolved", data: { questionRpcId: "plan" } }));
	await page.evaluate(() =>
		push({
			push: "question.requested",
			rpcId: "invalid",
			data: {
				sessionId: "a",
				questions: [
					{
						id: "q",
						question: "Incomplete plan",
						intent: { kind: "plan-review", approve: "Approve" },
						options: [{ label: "Approve" }],
					},
				],
			},
		}),
	);
	assert.equal(await page.locator("form.card button[type=submit]").isDisabled(), true);
	await page.locator("form.card").dispatchEvent("submit");
	assert.equal(await page.evaluate(() => calls.filter((c) => c.method === "respond").length), 0);
	evidence.passed.push("invalid plan blocked both visually and at submit entry");
	console.log(JSON.stringify(evidence));
} finally {
	await writeFile(`${out}/evidence.json`, JSON.stringify(evidence, null, 2));
	await page.evaluate(() => globalThis.disposeApp?.()).catch(() => {});
	await page.close();
	await context.close();
	await browser.close();
}
