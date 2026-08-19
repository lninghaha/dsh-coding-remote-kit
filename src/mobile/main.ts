/**
 * Mobile pairing page (vanilla TS). Loaded from the data plane at `/m`.
 *
 * Flow: read the pairing offer from the URL fragment → decode + validate →
 * persist the host → load/generate the mobile X25519 keypair → open the E2EE
 * WebSocket → run the 4-step handshake → call `status.get` → run the version
 * gate → keep the socket open and render the session / approval UI.
 */

import nacl from "tweetnacl";
import { base64Decode, base64Encode, utf8Decode, utf8Encode } from "../shared/base64.js";
import { MOBILE_PROTOCOL_VERSION } from "../shared/constants.js";
import { decodeOffer, validateOffer, type PairingOffer } from "../shared/offer.js";
import { evaluateVersionGate } from "../shared/version.js";
import { startConnectedApp } from "./app.js";
import { generateClientKeyPair, MobileE2eeSession } from "./e2ee.js";
import { MobileRpcClient } from "./rpc.js";

const HOST_KEY = "dshmr.host";
const KEY_KEY = "dshmr.key";

function root(): HTMLElement {
	const node = document.getElementById("app");
	if (node === null) throw new Error("missing #app root");
	return node;
}

function render(title: string, body: string, isError = false): void {
	document.documentElement.classList.add("connected");
	document.body.classList.add("connected");
	const app = root();
	app.className = "shell";
	app.textContent = `${title}\n\n${body}`;
	app.style.color = isError ? "#f87171" : "";
}

function registerShellWorker(): void {
	if (!("serviceWorker" in navigator)) return;
	const host = location.hostname;
	const secure = location.protocol === "https:" || host === "localhost" || host === "127.0.0.1";
	if (!secure) return;
	void navigator.serviceWorker.register("/m/sw.js", { scope: "/m/" });
}

function loadOrCreateKey(): { secretKey: Uint8Array; publicKey: Uint8Array } {
	try {
		const stored = localStorage.getItem(KEY_KEY);
		if (stored !== null) {
			const secretKey = base64Decode(stored);
			if (secretKey.length === 32) {
				return nacl.box.keyPair.fromSecretKey(secretKey);
			}
		}
	} catch {
		// localStorage unavailable; fall through to a fresh ephemeral key
	}
	const keyPair = generateClientKeyPair();
	try {
		localStorage.setItem(KEY_KEY, base64Encode(keyPair.secretKey));
	} catch {
		// non-persistent storage is acceptable for a single pairing session
	}
	return keyPair;
}

type Phase = "awaiting-ready" | "awaiting-authenticated" | "authenticated";

function connect(offer: PairingOffer): void {
	let phase: Phase = "awaiting-ready";
	const keyPair = loadOrCreateKey();
	const session = new MobileE2eeSession({
		clientSecretKey: keyPair.secretKey,
		clientPublicKey: keyPair.publicKey,
		pinnedPublicKeyB64: offer.publicKeyB64,
	});
	render("正在配对…", "正在与桌面建立加密连接");

	let ws: WebSocketLike;
	try {
		ws = new WebSocket(offer.endpoint);
	} catch {
		render("配对失败", "无法连接桌面服务，请确认手机与电脑在同一网络。", true);
		return;
	}

	const sendEncrypted = (value: unknown): void => {
		ws.send(base64Encode(session.sealOut(utf8Encode(JSON.stringify(value)))));
	};
	const rpc = new MobileRpcClient(sendEncrypted);
	let appStarted = false;

	ws.onopen = () => {
		ws.send(JSON.stringify(session.hello));
	};

	ws.onmessage = (event) => {
		if (typeof event.data !== "string") return;
		const text = event.data;
		if (phase === "awaiting-ready") {
			let ready: unknown;
			try {
				ready = JSON.parse(text);
			} catch {
				render("配对信息不符，已中止", "握手消息不是有效 JSON。", true);
				ws.close();
				return;
			}
			const result = session.receiveReady(ready);
			if (!result.ok) {
				if (result.reason === "pinned-key-mismatch") {
					render("配对信息不符，已中止", "服务端公钥与配对二维码钉死的公钥不一致。", true);
				} else {
					render("配对信息不符，已中止", "握手消息无效。", true);
				}
				ws.close();
				return;
			}
			phase = "awaiting-authenticated";
			const auth = session.auth(offer.deviceToken);
			ws.send(base64Encode(session.sealOut(utf8Encode(JSON.stringify(auth)))));
			return;
		}

		let sealed: Uint8Array;
		try {
			sealed = base64Decode(text);
		} catch {
			render("配对失败", "收到无法解码的消息。", true);
			ws.close();
			return;
		}
		const payload = session.openIn(sealed);
		if (payload === null) {
			if (session.consecutiveFailures >= 5) {
				render("配对失败", "连续解密失败，连接已中止。", true);
			} else {
				render("配对失败", "无法解密服务端消息。", true);
			}
			ws.close();
			return;
		}
		let message: Record<string, unknown>;
		try {
			message = JSON.parse(utf8Decode(payload)) as Record<string, unknown>;
		} catch {
			render("配对失败", "收到无效的加密载荷。", true);
			ws.close();
			return;
		}
		if (message.type === "e2ee_error") {
			const code = (message.error as { code?: string } | undefined)?.code ?? "unknown";
			render("配对失败", `服务端拒绝配对（${code}）。`, true);
			ws.close();
			return;
		}
		if (phase === "awaiting-authenticated") {
			const result = session.receiveAuthenticated(message);
			if (!result.ok) {
				render("配对信息不符，已中止", "握手校验失败。", true);
				ws.close();
				return;
			}
			phase = "authenticated";
			void enterConnected(rpc);
			return;
		}
		rpc.handleMessage(message);
	};

	ws.onerror = () => {
		if (phase !== "authenticated") render("配对失败", "与桌面服务的连接出错。", true);
	};

	ws.onclose = () => {
		rpc.failAll("disconnected");
		if (phase === "authenticated" || appStarted) {
			document.body.classList.remove("connected");
			render("已断开，请刷新", "与桌面的加密连接已关闭。", true);
		}
	};

	async function enterConnected(client: MobileRpcClient): Promise<void> {
		try {
			const result = (await client.request("status.get")) as
				| { protocolVersion?: number; minCompatibleMobileVersion?: number }
				| undefined;
			const verdict = evaluateVersionGate(MOBILE_PROTOCOL_VERSION, {
				protocolVersion: result?.protocolVersion ?? 1,
				minCompatibleMobileVersion: result?.minCompatibleMobileVersion ?? 1,
			});
			if (verdict === "mobile-too-old") {
				render("版本过旧", "手机端协议版本过旧，请更新后重试。", true);
				ws.close();
				return;
			}
			if (verdict === "desktop-too-old") {
				render("桌面版本过旧", "桌面端协议版本过旧，请更新 dsh 后重试。", true);
				ws.close();
				return;
			}
		} catch {
			// status.get failed → fail open (still show the connected state).
		}
		appStarted = true;
		const app = root();
		app.textContent = "";
		app.style.color = "";
		startConnectedApp(app, client);
	}
}

function bootE2eList(): void {
	const now = Date.now();
	const items: Array<Record<string, unknown>> = [];
	for (let workspace = 0; workspace < 12; workspace += 1) {
		const cwd = `/tmp/example-project/ws-${String(workspace)}`;
		for (let task = 0; task < 4; task += 1) {
			items.push({
				sessionId: `s-${String(workspace)}-${String(task)}`,
				title: `任务 ${String(workspace + 1)}.${String(task + 1)}`,
				running: false,
				blank: false,
				updatedAt: now - workspace * 86_400_000,
				cwd,
			});
		}
	}
	const client = {
		async request(method: string) {
			if (method === "host.subscribe") return { accepted: true };
			if (method === "session.list") return { items };
			return {};
		},
		onPush() {},
	} as unknown as MobileRpcClient;
	const app = root();
	app.textContent = "";
	app.style.color = "";
	startConnectedApp(app, client);
}

function bootPairForm(): void {
	document.documentElement.classList.add("connected");
	document.body.classList.add("connected");
	const app = root();
	app.className = "shell";
	app.textContent = "";
	app.style.color = "";
	const wrap = document.createElement("div");
	wrap.style.cssText = "padding:24px;display:flex;flex-direction:column;gap:12px;max-width:28rem;margin:0 auto;";
	const title = document.createElement("strong");
	title.textContent = "输入配对码";
	const hint = document.createElement("p");
	hint.style.cssText = "margin:0;color:#9a9a9a;font-size:14px;line-height:1.5";
	hint.textContent = "在桌面「移动远程」里生成二维码后，把 8 位配对码打在这里。也可以直接扫码。";
	const input = document.createElement("input");
	input.placeholder = "XXXX-XXXX";
	input.autocomplete = "one-time-code";
	input.setAttribute("inputmode", "text");
	const button = document.createElement("button");
	button.type = "button";
	button.textContent = "连接";
	const err = document.createElement("p");
	err.style.cssText = "margin:0;color:#f87171;font-size:13px";
	const submit = (): void => {
		err.textContent = "";
		button.disabled = true;
		void (async () => {
			try {
				const response = await fetch("/m/claim", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ code: input.value }),
				});
				const payload = (await response.json()) as { offer?: unknown; error?: { message?: string } };
				if (!response.ok || payload.offer === undefined) {
					err.textContent = payload.error?.message ?? "配对码无效";
					button.disabled = false;
					return;
				}
				const offer = validateOffer(payload.offer);
				try {
					localStorage.setItem(HOST_KEY, offer.pageUrl);
				} catch {
					// ignore
				}
				connect(offer);
			} catch {
				err.textContent = "无法提交配对码";
				button.disabled = false;
			}
		})();
	};
	button.addEventListener("click", submit);
	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter") submit();
	});
	wrap.append(title, hint, input, button, err);
	app.appendChild(wrap);
}

function boot(): void {
	registerShellWorker();
	if (new URLSearchParams(location.search).get("e2e") === "list") {
		bootE2eList();
		return;
	}
	const hash = location.hash;
	if (hash.length <= 1) {
		bootPairForm();
		return;
	}
	const code = hash.slice(1);
	let offer: PairingOffer;
	try {
		offer = decodeOffer(code);
	} catch (error) {
		render("配对失败", `配对二维码无效（${error instanceof Error ? error.message : "无法解析"}）。`, true);
		return;
	}
	try {
		localStorage.setItem(HOST_KEY, offer.pageUrl);
	} catch {
		// non-persistent storage is acceptable
	}
	connect(offer);
}

boot();
