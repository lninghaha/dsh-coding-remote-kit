/**
 * Browser e2e: workspace list must be a real scrollport.
 * When CHROME_CDP is set, talks to Chromium via CDP (Chrome lives in Docker).
 * Optional local static server on 127.0.0.1:19081 unless E2E_NO_SERVE=1.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { build as esbuild } from "esbuild";

const ROOT = fileURLToPath(new URL("../lib/mobile/", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const PORT = 19081;
const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".map": "application/json",
};

let server = null;
await prepareSettingsHarness();
if (process.env.E2E_NO_SERVE !== "1") {
	server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", `http://127.0.0.1:${String(PORT)}`);
		const relative =
			url.pathname === "/"
				? "index.html"
				: url.pathname.startsWith("/m/")
					? url.pathname.slice(3)
					: url.pathname.slice(1);
		if (relative.includes("..")) {
			response.writeHead(403);
			response.end();
			return;
		}
		const file = join(ROOT, relative);
		if (!existsSync(file)) {
			response.writeHead(404);
			response.end("not found");
			return;
		}
		response.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
		response.end(readFileSync(file));
	});
	await new Promise((resolve) => {
		server.listen(PORT, process.env.E2E_BIND ?? "127.0.0.1", resolve);
	});
}

const pageUrl = process.env.E2E_PAGE_URL ?? `http://127.0.0.1:${String(PORT)}/?e2e=list`;
let metrics;
try {
	if (!process.env.CHROME_CDP) throw new Error("CHROME_CDP is required (run scripts/e2e-mobile-scroll.sh)");
	metrics = await runViaCdp(process.env.CHROME_CDP, pageUrl);
} finally {
	server?.close();
	cleanupSettingsHarness();
}

console.log(JSON.stringify(metrics));
if (!metrics.ok) process.exit(1);
for (const profile of metrics.profiles) {
	if (profile.canScroll !== undefined && (!profile.canScroll || profile.afterTop < 100)) {
		console.error(`FAIL: ${profile.name} list is not a working scrollport`);
		process.exit(1);
	}
	if (profile.manifestStatus !== 200) {
		console.error(`FAIL: ${profile.name} manifest.webmanifest was not 200`);
		process.exit(1);
	}
}
const desktop = metrics.profiles.find((profile) => profile.name === "desktop-settings-dpr-1.25");
const interaction = metrics.profiles.find((profile) => profile.name === "desktop-mobile-interaction");
const narrow = metrics.profiles.find((profile) => profile.name === "narrow-reduced-motion");
if (desktop?.screenshot?.width !== 2048 || desktop?.screenshot?.height !== 1085) {
	console.error("FAIL: desktop physical screenshot is not 2048x1085");
	process.exit(1);
}
if (!desktop?.advancedHidden || !desktop?.connectionStep || !desktop?.pairStep || !desktop?.nameStep || !desktop?.doneStep) {
	console.error("FAIL: desktop progressive settings flow regression");
	process.exit(1);
}
if (!interaction?.draftPreserved || !interaction?.focusPreserved || !interaction?.selectionPreserved || !interaction?.dialogFocused || !interaction?.tabTrapped || !interaction?.escapeRestoredFocus) {
	console.error("FAIL: desktop draft/focus/dialog keyboard regression");
	process.exit(1);
}
if (interaction?.promptRequests !== 1 || interaction?.pushDisposals !== 1 || interaction?.subscribedAfterDispose !== false) {
	console.error("FAIL: duplicate submit or disposer regression");
	process.exit(1);
}
if (narrow?.dpr !== 1 || narrow?.innerWidth !== 390 || narrow?.innerHeight !== 700 || narrow?.reducedMotion !== true || narrow?.reducedMotionApplied !== true) {
	console.error("FAIL: narrow DPR1/reduced-motion profile was not applied");
	process.exit(1);
}
console.log("e2e-mobile-ux ok");

function measureScroll() {
	const col = document.querySelector(".col");
	if (!(col instanceof HTMLElement)) return { ok: false, reason: "missing .col" };
	col.scrollTop = 800;
	return {
		ok: true,
		scrollHeight: col.scrollHeight,
		clientHeight: col.clientHeight,
		afterTop: col.scrollTop,
		canScroll: col.scrollHeight > col.clientHeight + 40,
		workspaces: document.querySelectorAll(".ws").length,
		tasks: document.querySelectorAll(".task").length,
	};
}

async function runViaCdp(cdpOrigin, targetUrl) {
	const base = cdpOrigin.replace(/\/$/, "");
	const created = await fetchJson(`${base}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
	const wsUrl = created.webSocketDebuggerUrl;
	if (typeof wsUrl !== "string") throw new Error("chrome CDP missing page webSocketDebuggerUrl");
	const chrome = await openCdp(wsUrl);
	try {
		await chrome.send("Runtime.enable");
		await chrome.send("Page.enable");
		const profiles = [];
		for (const profile of [
			{ name: "desktop-settings-dpr-1.25", width: 1638, height: 868, dpr: 1.25, mobile: false, reduced: false, kind: "settings" },
			{ name: "desktop-mobile-interaction", width: 1638, height: 868, dpr: 1.25, mobile: false, reduced: false, kind: "mobile-interaction" },
			{ name: "narrow-reduced-motion", width: 390, height: 700, dpr: 1, mobile: true, reduced: true, kind: "mobile" },
		]) {
			await chrome.send("Emulation.setDeviceMetricsOverride", {
				width: profile.width,
				height: profile.height,
				deviceScaleFactor: profile.dpr,
				mobile: profile.mobile,
			});
			await chrome.send("Emulation.setEmulatedMedia", {
				features: [{ name: "prefers-reduced-motion", value: profile.reduced ? "reduce" : "no-preference" }],
			});
			const url = profile.kind === "settings" ? new URL("/m/e2e-settings.html", targetUrl).href : targetUrl;
			await chrome.send("Page.navigate", { url });
			await Promise.race([chrome.wait("Page.loadEventFired", 12_000), sleep(2_500)]);
			if (profile.kind === "settings") {
				const settings = await runSettingsInteraction(chrome);
				const environment = await evaluateValue(chrome, `({ innerWidth, innerHeight, dpr: devicePixelRatio, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches })`);
				const shot = await chrome.send("Page.captureScreenshot", { format: "png", fromSurface: true });
				profiles.push({ ...settings, ...environment, name: profile.name, screenshot: pngDimensions(Buffer.from(shot.data, "base64")), manifestStatus: 200, ok: Object.values(settings).every(Boolean) });
				continue;
			}
			let collapsed = { ok: false, reason: "missing .col" };
			for (let attempt = 0; attempt < 20 && !collapsed.ok; attempt += 1) {
				collapsed = await evaluateValue(chrome, `(${measureScroll.toString()})()`);
				if (!collapsed.ok) await sleep(100);
			}
			if (!collapsed.ok || collapsed.tasks !== 0) return { ok: false, profiles, reason: collapsed.reason ?? "initial list failed" };
			await evaluateValue(chrome, `document.querySelector(".ws-toggle")?.click(); "ok"`);
			await sleep(120);
			const after = await evaluateValue(chrome, `(${measureScroll.toString()})()`);
			const manifestStatus = await evaluateValue(chrome, `fetch("/m/manifest.webmanifest").then((r) => r.status)`, true);
			let interaction = {};
			if (profile.kind === "mobile-interaction") interaction = await runInteraction(chrome);
			const environment = await evaluateValue(chrome, `(() => {
				const style = getComputedStyle(document.querySelector("button"));
				const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
				return { innerWidth, innerHeight, dpr: devicePixelRatio, reducedMotion, reducedMotionApplied: !reducedMotion || style.transitionDuration === "1e-05s" || style.transitionDuration === "0.01ms" };
			})()`);
			const shot = await chrome.send("Page.captureScreenshot", { format: "png", fromSurface: true });
			profiles.push({
				...after,
				...environment,
				...interaction,
				name: profile.name,
				collapsedTasks: collapsed.tasks,
				manifestStatus,
				screenshot: pngDimensions(Buffer.from(shot.data, "base64")),
				ok: after.ok === true && after.tasks > 0 && after.canScroll === true,
			});
		}
		return { ok: profiles.every((profile) => profile.ok), profiles };
	} finally {
		chrome.close();
	}
}

async function runSettingsInteraction(chrome) {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (await evaluateValue(chrome, `/Connection|连接方式/.test(document.querySelector('[aria-current="step"]')?.textContent ?? "")`)) break;
		await sleep(80);
	}
	return evaluateValue(chrome, `(async () => {
		const text = () => document.body.innerText;
		const current = () => document.querySelector('[aria-current="step"]')?.textContent ?? "";
		const advancedHidden = !text().includes("19081");
		const connectionStep = /Connection|连接方式/.test(current());
		document.querySelector('input[name="channel"]')?.click();
		await Promise.resolve();
		const pairStep = /Pair|配对/.test(current());
		[...document.querySelectorAll("button")].find((button) => /Generate QR|生成二维码/.test(button.textContent))?.click();
		for (let attempt = 0; attempt < 20 && !/Name device|命名设备/.test(current()); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
		const nameStep = /Name device|命名设备/.test(current());
		globalThis.__dshmrSettingsE2e.connectNamedDevice();
		[...document.querySelectorAll("button")].find((button) => /Refresh|刷新/.test(button.textContent))?.click();
		for (let attempt = 0; attempt < 20 && !/Done|完成/.test(current()); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
		const doneStep = /Done|完成/.test(current());
		return { advancedHidden, connectionStep, pairStep, nameStep, doneStep };
	})()`, true);
}

async function prepareSettingsHarness() {
	const scriptPath = join(ROOT, "e2e-settings.js");
	await esbuild({
		stdin: {
			resolveDir: REPO_ROOT,
			sourcefile: "e2e-settings-entry.ts",
			contents: `
				import React from "react";
				import { createRoot } from "react-dom/client";
				import { MobileRemoteSettings } from "./src/client/index.ts";
				let devices = [];
				globalThis.__dshmrSettingsE2e = { connectNamedDevice() { devices = [{ deviceId: "device-e2e", displayName: "Pocket DSH", createdAt: Date.now(), lastSeenAt: Date.now(), scope: "mobile" }]; } };
				globalThis.fetch = async (input, init = {}) => {
					const url = String(input);
					let body;
					if (url.endsWith("/status")) body = { enabled: true, bind: "127.0.0.1", port: 19081, listening: true, networkReach: "lan", activeDevices: devices.length, tunnel: { running: false, kind: null, url: null, binaryOk: true }, relay: { running: false, kind: null, url: null, hostConnected: false, binaryOk: true, hasToken: false } };
					else if (url.endsWith("/devices")) body = { devices };
					else if (url.endsWith("/offers")) body = { offer: { expiresAt: Date.now() + 600000 }, qrText: "https://example.invalid/m#e2e", candidates: ["127.0.0.1"], pairCode: "ABCD-EFGH" };
					else body = { accepted: true };
					return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
				};
				createRoot(document.getElementById("settings")).render(React.createElement(MobileRemoteSettings));
			`,
		},
		outfile: scriptPath,
		bundle: true,
		format: "iife",
		platform: "browser",
		target: "es2022",
	});
	writeFileSync(join(ROOT, "e2e-settings.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mobile Remote settings E2E</title><body><main id="settings"></main><script src="/m/e2e-settings.js"></script></body></html>`);
}

function cleanupSettingsHarness() {
	rmSync(join(ROOT, "e2e-settings.js"), { force: true });
	rmSync(join(ROOT, "e2e-settings.html"), { force: true });
}

async function evaluateValue(chrome, expression, awaitPromise = false) {
	const result = await chrome.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
	if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "browser evaluation failed");
	return result.result?.value;
}

async function runInteraction(chrome) {
	await evaluateValue(chrome, `document.querySelector(".task")?.click(); "ok"`);
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (await evaluateValue(chrome, `document.querySelector("textarea") !== null`)) break;
		await sleep(80);
	}
	return evaluateValue(chrome, `(async () => {
		const input = document.querySelector(".composer textarea");
		input.value = "draft stays here";
		input.focus();
		input.setSelectionRange(2, 7);
		globalThis.__dshmrE2e.pushHostUpdate();
		await Promise.resolve();
		const next = document.querySelector(".composer textarea");
		const draftPreserved = next?.value === "draft stays here";
		const focusPreserved = document.activeElement === next;
		const selectionPreserved = next?.selectionStart === 2 && next?.selectionEnd === 7;
		document.querySelector('[data-sheet-trigger="session-info"]')?.click();
		await Promise.resolve();
		const dialogFocused = document.activeElement === document.querySelector(".sheet button");
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
		const tabTrapped = document.activeElement === document.querySelector(".sheet button");
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		await Promise.resolve();
		const escapeRestoredFocus = document.activeElement === document.querySelector('[data-sheet-trigger="session-info"]');
		const form = document.querySelector(".composer");
		const oldInput = form.querySelector("textarea");
		oldInput.value = "send once";
		form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		oldInput.value = "send twice";
		form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		await new Promise((resolve) => setTimeout(resolve, 120));
		globalThis.__dshmrE2e.dispose();
		globalThis.__dshmrE2e.pushHostUpdate();
		const lifecycle = globalThis.__dshmrE2e.metrics();
		return { draftPreserved, focusPreserved, selectionPreserved, dialogFocused, tabTrapped, escapeRestoredFocus, promptRequests: lifecycle.promptRequests, pushDisposals: lifecycle.pushDisposals, subscribedAfterDispose: lifecycle.subscribed };
	})()`, true);
}

function pngDimensions(bytes) {
	if (bytes.toString("ascii", 1, 4) !== "PNG") throw new Error("invalid PNG screenshot");
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function sleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function fetchJson(url, init) {
	const response = await fetch(url, init);
	if (!response.ok) throw new Error(`${url} ${String(response.status)}`);
	return response.json();
}

function openCdp(wsUrl) {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(wsUrl);
		const pending = new Map();
		const waiters = new Map();
		let nextId = 1;
		const timer = setTimeout(() => {
			reject(new Error("cdp websocket open timeout"));
		}, 8_000);
		socket.on("error", reject);
		socket.on("message", (raw) => {
			const message = JSON.parse(String(raw));
			if (message.id !== undefined && pending.has(message.id)) {
				const { resolve: done, reject: fail } = pending.get(message.id);
				pending.delete(message.id);
				if (message.error) fail(new Error(message.error.message ?? "cdp error"));
				else done(message.result ?? {});
			}
			if (typeof message.method === "string" && waiters.has(message.method)) {
				for (const done of waiters.get(message.method) ?? []) done(message.params);
				waiters.delete(message.method);
			}
		});
		socket.on("open", () => {
			clearTimeout(timer);
			resolve({
				send(method, params) {
					const id = nextId;
					nextId += 1;
					return new Promise((done, fail) => {
						pending.set(id, { resolve: done, reject: fail });
						socket.send(JSON.stringify({ id, method, params }));
					});
				},
				wait(method, timeoutMs) {
					return new Promise((done, fail) => {
						const waitTimer = setTimeout(() => {
							fail(new Error(`timeout waiting ${method}`));
						}, timeoutMs);
						if (!waiters.has(method)) waiters.set(method, []);
						waiters.get(method).push((params) => {
							clearTimeout(waitTimer);
							done(params);
						});
					});
				},
				close() {
					socket.close();
				},
			});
		});
	});
}
