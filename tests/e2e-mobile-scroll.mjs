/**
 * Browser e2e: workspace list must be a real scrollport.
 * When CHROME_CDP is set, talks to Chromium via CDP (Chrome lives in Docker).
 * Optional local static server on 127.0.0.1:19081 unless E2E_NO_SERVE=1.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const ROOT = fileURLToPath(new URL("../lib/mobile/", import.meta.url));
const PORT = 19081;
const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".map": "application/json",
};

let server = null;
if (process.env.E2E_NO_SERVE !== "1") {
	server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", `http://127.0.0.1:${String(PORT)}`);
		const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
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
}

console.log(JSON.stringify(metrics));
if (!metrics.ok) process.exit(1);
if (!metrics.canScroll) {
	console.error("FAIL: list is not a scrollport (cards are likely flex-shrunk)");
	process.exit(1);
}
if (metrics.afterTop < 100) {
	console.error("FAIL: setting scrollTop did not move the list");
	process.exit(1);
}
console.log("e2e-mobile-scroll ok");

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
		await chrome.send("Emulation.setDeviceMetricsOverride", {
			width: 390,
			height: 700,
			deviceScaleFactor: 2,
			mobile: true,
		});
		await chrome.send("Page.navigate", { url: targetUrl });
		await Promise.race([
			chrome.wait("Page.loadEventFired", 12_000),
			sleep(2_500),
		]);
		let last = { ok: false, reason: "missing .col" };
		for (let attempt = 0; attempt < 20; attempt += 1) {
			const result = await chrome.send("Runtime.evaluate", {
				expression: `(${measureScroll.toString()})()`,
				returnByValue: true,
			});
			last = result.result?.value ?? last;
			if (last.ok) return last;
			await sleep(200);
		}
		const dump = await chrome.send("Runtime.evaluate", {
			expression: `({ href: location.href, title: document.title, text: (document.body && document.body.innerText || '').slice(0, 400), html: (document.documentElement && document.documentElement.outerHTML || '').slice(0, 300) })`,
			returnByValue: true,
		});
		console.error("e2e dump", JSON.stringify(dump.result?.value ?? dump));
		return last;
	} finally {
		chrome.close();
	}
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
