/**
 * Mobile pairing page (vanilla TS). Loaded from the data plane at `/m`.
 */

import nacl from "tweetnacl";
import { base64Decode, base64Encode, utf8Decode, utf8Encode } from "../shared/base64.js";
import { MOBILE_PROTOCOL_VERSION } from "../shared/constants.js";
import {
	bootstrapLocale,
	getLocale,
	pairErrorMessage,
	setLocale,
	subscribeLocale,
	t,
} from "../shared/i18n/index.js";
import { decodeOffer, validateOffer, type PairingOffer } from "../shared/offer.js";
import { formatPairCode, isCompletePairCode, normalizePairCode } from "../shared/pair-code.js";
import { evaluateVersionGate } from "../shared/version.js";
import { startConnectedApp } from "./app.js";
import { generateClientKeyPair, MobileE2eeSession } from "./e2ee.js";
import { clearPersistedOffer, loadPersistedOffer, persistOffer } from "./persist.js";
import { MobileRpcClient } from "./rpc.js";

const KEY_KEY = "dshmr.key";

type NoticeTone = "info" | "error" | "warn";

interface NoticeAction {
	label: string;
	onClick: () => void;
	ghost?: boolean;
	danger?: boolean;
}

interface NoticeOptions {
	title: string;
	message: string;
	tone?: NoticeTone;
	loading?: boolean;
	actions?: NoticeAction[];
}

let lastOffer: PairingOffer | null = null;
let lastConnectOptions: { fallbackToPin?: boolean } = {};
let rerenderCurrent: (() => void) | null = null;

function appendLanguageSwitcher(container: HTMLElement): void {
	const wrap = document.createElement("div");
	wrap.className = "lang-switch";
	const locales = [
		{ locale: "zh-CN" as const, labelKey: "common.lang.zh" as const },
		{ locale: "en" as const, labelKey: "common.lang.en" as const },
	];
	for (const [index, entry] of locales.entries()) {
		if (index > 0) wrap.appendChild(document.createTextNode(" | "));
		const button = document.createElement("button");
		button.type = "button";
		button.className = getLocale() === entry.locale ? "active" : "";
		button.textContent = t(entry.labelKey);
		button.addEventListener("click", () => {
			setLocale(entry.locale, localStorage);
		});
		wrap.appendChild(button);
	}
	container.appendChild(wrap);
}

function root(): HTMLElement {
	const node = document.getElementById("app");
	if (node === null) throw new Error("missing #app root");
	return node;
}

function renderNoticeCard(getOptions: () => NoticeOptions): void {
	rerenderCurrent = () => renderNoticeCard(getOptions);
	const options = getOptions();
	document.documentElement.classList.add("connected");
	document.body.classList.add("connected");
	const app = root();
	app.className = "shell";
	app.replaceChildren();
	const wrap = document.createElement("div");
	wrap.className = "notice-wrap";
	const card = document.createElement("div");
	card.className = `notice-card${options.tone === "error" ? " error" : options.tone === "warn" ? " warn" : ""}`;
	if (options.loading) {
		const spinner = document.createElement("div");
		spinner.className = "spinner";
		card.appendChild(spinner);
	}
	const title = document.createElement("h1");
	title.textContent = options.title;
	card.appendChild(title);
	const body = document.createElement("p");
	body.textContent = options.message;
	card.appendChild(body);
	if (options.actions !== undefined && options.actions.length > 0) {
		const actions = document.createElement("div");
		actions.className = "actions";
		for (const action of options.actions) {
			const button = document.createElement("button");
			button.type = "button";
			button.textContent = action.label;
			if (action.ghost) button.className = "ghost";
			if (action.danger) button.className = "danger";
			button.addEventListener("click", action.onClick);
			actions.appendChild(button);
		}
		card.appendChild(actions);
	}
	appendLanguageSwitcher(card);
	wrap.appendChild(card);
	app.appendChild(wrap);
}

function render(title: string, body: string, isError = false): void {
	renderNoticeCard(() => ({
		title,
		message: body,
		tone: isError ? "error" : "info",
	}));
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

function connect(offer: PairingOffer, options: { fallbackToPin?: boolean } = {}): void {
	lastOffer = offer;
	lastConnectOptions = options;
	let phase: Phase = "awaiting-ready";
	const keyPair = loadOrCreateKey();
	const session = new MobileE2eeSession({
		clientSecretKey: keyPair.secretKey,
		clientPublicKey: keyPair.publicKey,
		pinnedPublicKeyB64: offer.publicKeyB64,
	});
	const failNotice = (titleKey: Parameters<typeof t>[0], messageKey: Parameters<typeof t>[0], vars?: Record<string, string | number>): void => {
		renderNoticeCard(() => ({
			title: t(titleKey),
			message: t(messageKey, vars),
			tone: "error",
			actions: [
				{ label: t("pair.retryConnect"), onClick: () => connect(offer, options) },
				{ label: t("pair.changeCode"), onClick: () => bootPairForm(), ghost: true },
				{
					label: t("pair.clearLocal"),
					onClick: () => {
						clearPersistedOffer(localStorage);
						bootPairForm();
					},
					danger: true,
				},
			],
		}));
	};

	renderNoticeCard(() => ({
		title: t("pair.loading.title"),
		message: t("pair.loading.body"),
		loading: true,
	}));

	let ws: WebSocketLike;
	try {
		ws = new WebSocket(offer.endpoint);
	} catch {
		if (options.fallbackToPin === true) {
			bootPairForm();
			return;
		}
		renderNoticeCard(() => ({
			title: t("pair.failed.title"),
			message: t("pair.failed.unreachable"),
			tone: "error",
			actions: [
				{ label: t("common.retry"), onClick: () => connect(offer, options) },
				{ label: t("pair.enterPin"), onClick: () => bootPairForm(), ghost: true },
			],
		}));
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
				failNotice("pair.mismatch", "pair.badHandshakeJson");
				ws.close();
				return;
			}
			const result = session.receiveReady(ready);
			if (!result.ok) {
				if (result.reason === "pinned-key-mismatch") {
					failNotice("pair.mismatch", "pair.pubkeyMismatch");
				} else {
					failNotice("pair.mismatch", "pair.badHandshake");
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
			failNotice("pair.failed.title", "pair.undecodable");
			ws.close();
			return;
		}
		const payload = session.openIn(sealed);
		if (payload === null) {
			if (session.consecutiveFailures >= 5) {
				failNotice("pair.failed.title", "pair.decryptAbort");
			} else {
				failNotice("pair.failed.title", "pair.decryptFail");
			}
			ws.close();
			return;
		}
		let message: Record<string, unknown>;
		try {
			message = JSON.parse(utf8Decode(payload)) as Record<string, unknown>;
		} catch {
			failNotice("pair.failed.title", "pair.badPayload");
			ws.close();
			return;
		}
		if (message.type === "e2ee_error") {
			const code = (message.error as { code?: string } | undefined)?.code ?? "unknown";
			failNotice("pair.failed.title", "pair.failed.serverRejected", { code });
			ws.close();
			return;
		}
		if (phase === "awaiting-authenticated") {
			const result = session.receiveAuthenticated(message);
			if (!result.ok) {
				failNotice("pair.mismatch", "pair.handshakeVerifyFail");
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
		if (phase !== "authenticated" && options.fallbackToPin === true) {
			bootPairForm();
			return;
		}
		if (phase !== "authenticated") failNotice("pair.failed.title", "pair.wsError");
	};

	ws.onclose = () => {
		rpc.failAll("disconnected");
		if (phase === "authenticated" || appStarted) {
			document.body.classList.remove("connected");
			const retryOffer = lastOffer;
			renderNoticeCard(() => ({
				title: t("pair.disconnected.title"),
				message: t("pair.disconnected.body"),
				tone: "warn",
				actions: [
					{
						label: t("pair.retryConnect"),
						onClick: () => {
							if (retryOffer !== null) connect(retryOffer, lastConnectOptions);
							else bootPairForm();
						},
					},
					{ label: t("pair.changeCode"), onClick: () => bootPairForm(), ghost: true },
					{
						label: t("pair.clearLocal"),
						onClick: () => {
							clearPersistedOffer(localStorage);
							bootPairForm();
						},
						danger: true,
					},
				],
			}));
			return;
		}
		if (options.fallbackToPin === true && phase !== "authenticated") {
			bootPairForm();
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
				renderNoticeCard(() => ({
					title: t("pair.mobileTooOld.title"),
					message: t("pair.mobileTooOld.body"),
					tone: "error",
					actions: [{ label: t("pair.changeCode"), onClick: () => bootPairForm(), ghost: true }],
				}));
				ws.close();
				return;
			}
			if (verdict === "desktop-too-old") {
				renderNoticeCard(() => ({
					title: t("pair.desktopTooOld.title"),
					message: t("pair.desktopTooOld.body"),
					tone: "error",
					actions: [{ label: t("pair.changeCode"), onClick: () => bootPairForm(), ghost: true }],
				}));
				ws.close();
				return;
			}
		} catch {
			// status.get failed → fail open (still show the connected state).
		}
		appStarted = true;
		rerenderCurrent = null;
		const app = root();
		app.textContent = "";
		app.className = "shell";
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
				title: t("app.taskLabel", { workspace: workspace + 1, task: task + 1 }),
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
	rerenderCurrent = null;
	const app = root();
	app.textContent = "";
	app.className = "shell";
	startConnectedApp(app, client);
}

function bootPairForm(): void {
	rerenderCurrent = bootPairForm;
	document.documentElement.classList.add("connected");
	document.body.classList.add("connected");
	const app = root();
	app.className = "shell";
	app.replaceChildren();

	const wrap = document.createElement("div");
	wrap.className = "pair-form";
	const card = document.createElement("div");
	card.className = "pair-card";

	const heading = document.createElement("h1");
	heading.textContent = t("pair.enterPin");
	const hint = document.createElement("p");
	hint.className = "hint";
	hint.textContent = t("pair.form.hint");

	const input = document.createElement("input") as HTMLInputElement;
	input.placeholder = "XXXX-XXXX";
	input.autocomplete = "one-time-code";
	input.setAttribute("inputmode", "text");
	input.setAttribute("autocapitalize", "characters");
	input.setAttribute("spellcheck", "false");

	const button = document.createElement("button");
	button.type = "button";
	button.textContent = t("pair.form.connect");

	const err = document.createElement("p");
	err.className = "err";

	const formatInput = (raw: string): string => {
		const normalized = normalizePairCode(raw);
		if (normalized.length <= 4) return normalized;
		return `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}`;
	};

	input.addEventListener("input", () => {
		const formatted = formatInput(input.value);
		if (formatted !== input.value) {
			input.value = formatted;
		}
		err.textContent = "";
		if (isCompletePairCode(input.value)) submit();
	});

	const submit = (): void => {
		err.textContent = "";
		if (!isCompletePairCode(input.value)) {
			err.textContent = t("pair.form.incomplete");
			return;
		}
		button.disabled = true;
		const displayCode = formatPairCode(normalizePairCode(input.value));
		void (async () => {
			try {
				const response = await fetch("/m/claim", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ code: displayCode }),
				});
				const payload = (await response.json()) as { offer?: unknown; error?: { code?: string } };
				if (!response.ok || payload.offer === undefined) {
					err.textContent = pairErrorMessage(payload.error?.code);
					button.disabled = false;
					return;
				}
				const offer = validateOffer(payload.offer);
				try {
					persistOffer(localStorage, offer);
				} catch {
					// ignore
				}
				connect(offer);
			} catch {
				err.textContent = t("pair.form.submitFailed");
				button.disabled = false;
			}
		})();
	};

	button.addEventListener("click", submit);
	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter") submit();
	});

	const clearBtn = document.createElement("button");
	clearBtn.type = "button";
	clearBtn.className = "ghost";
	clearBtn.textContent = t("pair.clearSaved");
	clearBtn.addEventListener("click", () => {
		clearPersistedOffer(localStorage);
		err.textContent = t("pair.cleared");
	});

	card.append(heading, hint, input, button, err, clearBtn);
	appendLanguageSwitcher(card);
	wrap.appendChild(card);
	app.appendChild(wrap);
	queueMicrotask(() => input.focus());
}

function boot(): void {
	registerShellWorker();
	if (new URLSearchParams(location.search).get("e2e") === "list") {
		bootE2eList();
		return;
	}
	const hash = location.hash;
	if (hash.length <= 1) {
		let persisted: PairingOffer | null = null;
		try {
			persisted = loadPersistedOffer(localStorage);
		} catch {
			persisted = null;
		}
		if (persisted !== null) {
			connect(persisted, { fallbackToPin: true });
			return;
		}
		bootPairForm();
		return;
	}
	const code = hash.slice(1);
	let offer: PairingOffer;
	try {
		offer = decodeOffer(code);
	} catch (error) {
		renderNoticeCard(() => ({
			title: t("pair.failed.title"),
			message: t("pair.qr.invalid", {
				detail: error instanceof Error ? error.message : t("pair.qr.parseFailed"),
			}),
			tone: "error",
			actions: [{ label: t("pair.enterPin"), onClick: () => bootPairForm() }],
		}));
		return;
	}
	try {
		persistOffer(localStorage, offer);
	} catch {
		// non-persistent storage is acceptable
	}
	connect(offer);
}

bootstrapLocale();
subscribeLocale(() => {
	rerenderCurrent?.();
});
boot();
