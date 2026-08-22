import { createElement, useEffect, useState } from "react";
import qrcode from "qrcode-generator";
import { formatPairCode } from "../shared/pair-code.js";
import {
	bootstrapLocale,
	formatAgo,
	setLocale,
	t,
	type Locale,
} from "../shared/i18n/index.js";

// Slots is an optional host capability. Older DSH clients must still load the
// plugin and receive the standalone recovery entry below.
export const inject: string[] = [];

interface SlotsApi {
	inject(name: string, factory: () => unknown): unknown;
	register(
		options: {
			name: string;
			id: string;
			order?: number;
			label?: unknown;
		},
		component: unknown,
	): unknown;
}

interface ClientApplyContext {
	readonly slots?: SlotsApi;
	inject?(names: readonly string[], factory: (context: ClientApplyContext) => unknown): unknown;
	effect?(factory: () => void | (() => void)): unknown;
}

interface StatusInfo {
	enabled: boolean;
	accessMode?: "loopback" | "ssh-tunnel" | "trusted-https-proxy";
	bind: string;
	port: number;
	listening: boolean;
	networkReach: string;
	activeDevices: number;
	tunnel: TunnelSnapshot;
	relay: RelaySnapshot;
	compatibility?: {
		apiProxy: { available: boolean; source: string };
		webServer: { available: boolean; source: string };
		coreAbi?: string;
		dshVersion?: string | null;
		verifiedBom?: { id?: string };
		status?: "healthy" | "degraded" | "incompatible";
		capabilities?: Readonly<Record<string, { state: "available" | "missing" | "incompatible"; contract: string; reason?: string }>>;
		diagnostics?: readonly string[];
		recommendations?: readonly string[];
		ownerRequest?: {
			source: "host" | "plugin-fallback";
			diagnostics: readonly { id: string; level: "info" | "error"; message: string }[];
		};
	};
}

interface TunnelSnapshot {
	running: boolean;
	kind: "cloudflare-quick" | null;
	url: string | null;
	binaryOk: boolean;
}

interface RelaySnapshot {
	running: boolean;
	kind: "rendezvous" | null;
	url: string | null;
	hostConnected: boolean;
	binaryOk: boolean;
	hasToken: boolean;
}

type Channel = "lan" | "public" | "relay";
type ResourceState = "loading" | "ready" | "empty" | "unavailable" | "permissionDenied" | "stale";

interface OfferInfo {
	qrText: string;
	candidates: string[];
	expiresAt: number;
	pairCode: string;
	initialRemainingMs: number;
}

interface DeviceInfo {
	deviceId: string;
	displayName?: string;
	createdAt: number;
	lastSeenAt: number;
	revokedAt?: number;
	scope: string;
}

const QR_QUIET = 16;
const QR_CELL = 4;

function renderQr(qrText: string): void {
	const canvas = document.getElementById("dsh-mobile-remote-qr") as HTMLCanvasElement | null;
	if (canvas === null) return;
	const qr = qrcode(0, "M");
	qr.addData(qrText);
	qr.make();
	const count = qr.getModuleCount();
	const inner = count * QR_CELL;
	canvas.width = inner + QR_QUIET * 2;
	canvas.height = inner + QR_QUIET * 2;
	const context = canvas.getContext("2d");
	if (context === null) return;
	context.fillStyle = "#ffffff";
	context.fillRect(0, 0, canvas.width, canvas.height);
	qr.renderTo2dContext(context, QR_CELL, QR_QUIET, QR_QUIET);
}

function formatRemaining(ms: number): string {
	const total = Math.max(0, Math.ceil(ms / 1000));
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}


function deviceOnline(lastSeenAt: number): boolean {
	return lastSeenAt > 0 && Date.now() - lastSeenAt < 120_000;
}

async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		try {
			const area = document.createElement("textarea");
			area.value = text;
			area.style.position = "fixed";
			area.style.opacity = "0";
			document.body.appendChild(area);
			area.select();
			const ok = document.execCommand("copy");
			document.body.removeChild(area);
			return ok;
		} catch {
			return false;
		}
	}
}

export function MobileRemoteSettings() {
	const [status, setStatus] = useState<StatusInfo | null>(null);
	const [channel, setChannel] = useState<Channel>("lan");
	const [offerInfo, setOfferInfo] = useState<OfferInfo | null>(null);
	const [devices, setDevices] = useState<DeviceInfo[]>([]);
	const [statusError, setStatusError] = useState<string | null>(null);
	const [devicesError, setDevicesError] = useState<string | null>(null);
	const [statusState, setStatusState] = useState<ResourceState>("loading");
	const [devicesState, setDevicesState] = useState<ResourceState>("loading");
	const [channelError, setChannelError] = useState<string | null>(null);
	const [offerError, setOfferError] = useState<string | null>(null);
	const [remainingMs, setRemainingMs] = useState<number | null>(null);
	const [tunnelBusy, setTunnelBusy] = useState(false);
	const [relayBusy, setRelayBusy] = useState(false);
	const [installBusy, setInstallBusy] = useState(false);
	const [showOfferText, setShowOfferText] = useState(false);
	const [relayOrigin, setRelayOrigin] = useState("");
	const [relayToken, setRelayToken] = useState("");
	const [copyToast, setCopyToast] = useState<string | null>(null);
	const [revokePendingId, setRevokePendingId] = useState<string | null>(null);
	const [showAdvancedNetwork, setShowAdvancedNetwork] = useState(false);
	const [channelChosen, setChannelChosen] = useState(false);
	const [locale, setLocaleState] = useState<Locale>(() => bootstrapLocale());

	const switchLocale = (next: Locale) => {
		setLocale(next, typeof localStorage !== "undefined" ? localStorage : null);
		setLocaleState(next);
	};

	const formatApiError = (
		response: Response,
		payload: { error?: { message?: string } } | null,
		fallback: string,
	): string => {
		const detail = payload?.error?.message;
		if (typeof detail === "string" && detail.length > 0) {
			return t("settings.error.withDetail", { fallback, status: String(response.status), detail });
		}
		return t("settings.error.withHttp", { fallback, status: String(response.status) });
	};

	const showCopyToast = (message: string) => {
		setCopyToast(message);
		setTimeout(() => setCopyToast(null), 2000);
	};

	const refreshStatus = () => {
		if (status === null) setStatusState("loading");
		void (async () => {
			try {
				const response = await fetch("/api/mobile-remote/status", {
					headers: { "x-dsh-mobile-remote": "1" },
				});
				const payload = (await response.json()) as StatusInfo & { error?: { message?: string } };
				if (!response.ok || typeof payload.bind !== "string") {
					setStatusError(formatApiError(response, payload, t("settings.status.readFailed")));
					setStatusState(response.status === 401 || response.status === 403 ? "permissionDenied" : status === null ? "unavailable" : "stale");
					return;
				}
				setStatusError(null);
				setStatus(payload);
				setStatusState("ready");
				if (typeof payload.relay?.url === "string" && payload.relay.url.length > 0) {
					setRelayOrigin(payload.relay.url);
				}
			} catch {
				setStatusError(t("settings.status.readFailed"));
				setStatusState(status === null ? "unavailable" : "stale");
			}
		})();
	};

	const refreshDevices = () => {
		if (devices.length === 0) setDevicesState("loading");
		void (async () => {
			try {
				const response = await fetch("/api/mobile-remote/devices", {
					headers: { "x-dsh-mobile-remote": "1" },
				});
				const payload = (await response.json()) as { devices?: DeviceInfo[]; error?: { message?: string } };
				if (!response.ok) {
					setDevicesError(formatApiError(response, payload, t("settings.devices.readFailed")));
					setDevicesState(response.status === 401 || response.status === 403 ? "permissionDenied" : devices.length === 0 ? "unavailable" : "stale");
					return;
				}
				const rows = Array.isArray(payload.devices) ? payload.devices : [];
				setDevicesError(null);
				setDevices(rows);
				setDevicesState(rows.length === 0 ? "empty" : "ready");
			} catch {
				setDevicesError(t("settings.devices.readFailed"));
				setDevicesState(devices.length === 0 ? "unavailable" : "stale");
			}
		})();
	};

	useEffect(() => {
		refreshStatus();
		refreshDevices();
	}, []);

	useEffect(() => {
		if (offerInfo === null) return;
		renderQr(offerInfo.qrText);
		const tick = () => setRemainingMs(Math.max(0, offerInfo.expiresAt - Date.now()));
		tick();
		const timer = setInterval(tick, 1000);
		return () => clearInterval(timer);
	}, [offerInfo]);

	const revokeDevice = (deviceId: string) => {
		setOfferError(null);
		void (async () => {
			try {
				const response = await fetch("/api/mobile-remote/revoke", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-dsh-mobile-remote": "1",
					},
					body: JSON.stringify({ deviceId }),
				});
				if (!response.ok) {
					setOfferError(t("settings.devices.revokeFailed"));
					return;
				}
				setRevokePendingId(null);
				refreshDevices();
				refreshStatus();
			} catch {
				setOfferError(t("settings.devices.revokeFailed"));
			}
		})();
	};

	const extractTunnelHost = (url: string | null): string | null => {
		if (typeof url !== "string" || url.length === 0) return null;
		try {
			return new URL(url).host;
		} catch {
			return null;
		}
	};

	const postJson = async (path: string, body: unknown): Promise<{ ok: boolean; status: number; payload: Record<string, unknown> }> => {
		const response = await fetch(path, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-dsh-mobile-remote": "1",
			},
			body: JSON.stringify(body),
		});
		const payload = (await response.json()) as Record<string, unknown>;
		return { ok: response.ok, status: response.status, payload };
	};

	const tunnelAction = async (action: "start" | "stop"): Promise<boolean> => {
		if (tunnelBusy) return false;
		setChannelError(null);
		setTunnelBusy(true);
		try {
			const { ok, status: httpStatus, payload } = await postJson("/api/mobile-remote/tunnel", {
				action,
				kind: "cloudflare-quick",
			});
			if (!ok) {
				setChannelError(
					formatApiError(
						{ status: httpStatus } as Response,
						payload as { error?: { message?: string } },
						action === "start" ? t("settings.tunnel.startFailed") : t("settings.tunnel.stopFailed"),
					),
				);
				return false;
			}
			refreshStatus();
			if (action === "start") setChannel("public");
			if (action === "stop") setChannel("lan");
			return true;
		} catch {
			setChannelError(action === "start" ? t("settings.tunnel.startFailed") : t("settings.tunnel.stopFailed"));
			return false;
		} finally {
			setTunnelBusy(false);
		}
	};

	const installCloudflared = () => {
		if (installBusy) return;
		setChannelError(null);
		setInstallBusy(true);
		void (async () => {
			try {
				const { ok, status: httpStatus, payload } = await postJson("/api/mobile-remote/cloudflared", {
					action: "install",
				});
				if (!ok) {
					setChannelError(
						formatApiError(
							{ status: httpStatus } as Response,
							payload as { error?: { message?: string } },
							t("settings.tunnel.installFailed"),
						),
					);
					return;
				}
				refreshStatus();
			} catch {
				setChannelError(t("settings.tunnel.installFailed"));
			} finally {
				setInstallBusy(false);
			}
		})();
	};

	const relayAction = async (action: "start" | "stop"): Promise<boolean> => {
		if (relayBusy) return false;
		setChannelError(null);
		setRelayBusy(true);
		try {
			const body: Record<string, unknown> = { action };
			if (action === "start") {
				body.origin = relayOrigin.trim();
				if (relayToken.trim().length > 0) body.hostToken = relayToken.trim();
			}
			const { ok, status: httpStatus, payload } = await postJson("/api/mobile-remote/relay", body);
			if (!ok) {
				setChannelError(
					formatApiError(
						{ status: httpStatus } as Response,
						payload as { error?: { message?: string } },
						action === "start" ? t("settings.relay.startFailed") : t("settings.relay.stopFailed"),
					),
				);
				return false;
			}
			if (action === "start") setRelayToken("");
			refreshStatus();
			if (action === "start") setChannel("relay");
			if (action === "stop") setChannel("lan");
			return true;
		} catch {
			setChannelError(action === "start" ? t("settings.relay.startFailed") : t("settings.relay.stopFailed"));
			return false;
		} finally {
			setRelayBusy(false);
		}
	};

	const selectLan = () => {
		setChannel("lan");
		if (status?.tunnel.running) void tunnelAction("stop");
		if (status?.relay?.running) void relayAction("stop");
	};

	const createOffer = () => {
		setChannelChosen(true);
		setOfferError(null);
		void (async () => {
			try {
				if (channel === "public") {
					if (!(status?.tunnel.binaryOk ?? false)) {
						setOfferError(t("settings.offer.needBinary"));
						return;
					}
					if (!(status?.tunnel.running ?? false)) {
						const started = await tunnelAction("start");
						if (!started) return;
					}
				}
				if (channel === "relay") {
					if (!(status?.relay?.hostConnected ?? false)) {
						const started = await relayAction("start");
						if (!started) return;
					}
				}
				const { ok, status: httpStatus, payload } = await postJson("/api/mobile-remote/offers", {});
				if (!ok) {
					setOfferError(
						formatApiError(
							{ status: httpStatus } as Response,
							payload as { error?: { message?: string } },
							t("settings.offer.failed"),
						),
					);
					return;
				}
				const offer = payload.offer as { expiresAt: number };
				const expiresAt = offer.expiresAt;
				const initialRemainingMs = Math.max(0, expiresAt - Date.now());
				setOfferInfo({
					qrText: String(payload.qrText ?? ""),
					candidates: Array.isArray(payload.candidates) ? (payload.candidates as string[]) : [],
					expiresAt,
					pairCode: String(payload.pairCode ?? ""),
					initialRemainingMs: initialRemainingMs > 0 ? initialRemainingMs : 600_000,
				});
				setShowOfferText(false);
				refreshStatus();
			} catch {
				setOfferError(t("settings.offer.failed"));
			}
		})();
	};

	const tunnelHost = extractTunnelHost(status?.tunnel.url ?? null);
	const tunnelRunning = status?.tunnel.running ?? false;
	const tunnelBinaryOk = status?.tunnel.binaryOk ?? false;
	const relayRunning = status?.relay?.running ?? false;
	const relayConnected = status?.relay?.hostConnected ?? false;
	const relayHost = extractTunnelHost(status?.relay?.url ?? null);
	const publicMode = !relayRunning && (tunnelRunning || channel === "public");
	const relayMode = relayRunning || channel === "relay";
	const lanMode = !publicMode && !relayMode;
	const offerExpired = offerInfo !== null && remainingMs !== null && remainingMs <= 0;
	const progressPct =
		offerInfo !== null && remainingMs !== null && offerInfo.initialRemainingMs > 0
			? Math.max(0, Math.min(100, (remainingMs / offerInfo.initialRemainingMs) * 100))
			: 0;
	const progressUrgent = remainingMs !== null && remainingMs > 0 && remainingMs <= 60_000;
	const activeDevice = devices.find((device) => device.revokedAt === undefined);
	const flowStep = activeDevice !== undefined ? 4 : offerInfo !== null ? 3 : channelChosen ? 2 : 1;
	const flowLabels = [
		t("settings.flow.connection"),
		t("settings.flow.pair"),
		t("settings.flow.name"),
		t("settings.flow.done"),
	];

	const box: Record<string, string | number> = {
		display: "grid",
		gap: "8px",
		padding: "12px",
		border: "1px solid var(--dshmr-line, rgba(127,127,127,0.35))",
		borderRadius: "10px",
	};
	const muted: Record<string, string | number> = { margin: 0, fontSize: "13px", opacity: 0.75 };
	const errStyle: Record<string, string | number> = { margin: 0, color: "#b3261e", fontSize: "13px" };
	const warnStyle: Record<string, string | number> = { ...muted, color: "#8a5a00" };

	const formattedPin =
		offerInfo !== null && offerInfo.pairCode.length > 0 ? formatPairCode(offerInfo.pairCode.replace(/-/g, "")) : "";

	return createElement(
		"section",
		{
			style: {
				display: "grid",
				gap: "16px",
				maxWidth: "40rem",
				lineHeight: 1.55,
				["--dshmr-line" as string]: "rgba(127,127,127,0.35)",
				["--dshmr-ok" as string]: "#15803d",
				["--dshmr-warn" as string]: "#b45309",
				["--dshmr-err" as string]: "#b3261e",
			},
		},
		copyToast !== null
			? createElement(
					"p",
					{
						style: {
							position: "sticky",
							top: 0,
							margin: 0,
							padding: "8px 12px",
							borderRadius: "8px",
							background: "rgba(34,197,94,0.15)",
							fontSize: "13px",
							zIndex: 1,
						},
					},
					copyToast,
				)
			: null,
		createElement(
			"div",
			{
				style: {
					display: "flex",
					gap: "8px",
					alignItems: "center",
					justifyContent: "flex-end",
					fontSize: "13px",
				},
			},
			createElement("span", { style: muted }, t("common.language")),
			createElement(
				"button",
				{
					type: "button",
					onClick: () => switchLocale("zh-CN"),
					style: {
						fontWeight: locale === "zh-CN" ? 700 : 400,
						opacity: locale === "zh-CN" ? 1 : 0.65,
					},
				},
				t("common.lang.zh"),
			),
			createElement(
				"button",
				{
					type: "button",
					onClick: () => switchLocale("en"),
					style: {
						fontWeight: locale === "en" ? 700 : 400,
						opacity: locale === "en" ? 1 : 0.65,
					},
				},
				t("common.lang.en"),
			),
		),
		createElement(
			"ol",
			{
				style: {
					margin: 0,
					padding: 0,
					listStyle: "none",
					display: "grid",
					gridTemplateColumns: "repeat(auto-fit, minmax(8rem, 1fr))",
					gap: "8px",
				},
				"aria-label": t("settings.flow.label"),
			},
			...flowLabels.map((label, index) => {
				const step = index + 1;
				return createElement(
					"li",
					{
						key: label,
						...(step === flowStep ? { "aria-current": "step" } : {}),
						style: {
							padding: "8px 10px",
							borderRadius: "8px",
							background: step === flowStep ? "rgba(59,130,246,.14)" : "rgba(127,127,127,.08)",
							opacity: step > flowStep ? 0.55 : 1,
							fontSize: "13px",
						},
					},
					`${String(step)}. ${label}`,
				);
			}),
		),
		createElement(
			"div",
			{
				style: {
					...box,
					gridTemplateColumns: "1fr auto",
					alignItems: "center",
					gap: "12px",
				},
			},
			createElement(
				"div",
				{ style: { display: "grid", gap: "4px" } },
				createElement("strong", { style: { fontSize: "14px" } }, t("settings.status.title")),
				status === null
					? createElement(
							"span",
							{ style: statusState === "permissionDenied" || statusState === "unavailable" ? errStyle : muted, role: "status" },
							statusError ?? t("settings.status.reading"),
						)
					: createElement(
							"span",
							{ style: { fontSize: "13px" } },
							statusState === "stale" ? t("settings.state.stale") : t("settings.status.ready"),
						),
			),
			createElement(
				"button",
				{
					type: "button",
					onClick: () => {
						refreshStatus();
						refreshDevices();
					},
					style: { justifySelf: "end" },
				},
				t("settings.status.refresh"),
			),
			statusError !== null && status === null
				? createElement("p", { style: { ...errStyle, gridColumn: "1 / -1" } }, statusError)
				: null,
			status !== null
				? createElement(
						"div",
						{ style: { display: "grid", gap: "6px", gridColumn: "1 / -1" } },
						createElement(
							"button",
							{
								type: "button",
								onClick: () => setShowAdvancedNetwork((value) => !value),
								"aria-expanded": showAdvancedNetwork,
								style: { justifySelf: "start" },
							},
							showAdvancedNetwork ? t("settings.advanced.hide") : t("settings.advanced.show"),
						),
						showAdvancedNetwork
							? createElement(
									"p",
									{ style: muted },
									t("settings.status.summary", {
										listen: status.listening ? t("settings.status.listening") : t("settings.status.notListening"),
										port: String(status.port),
										reach: status.networkReach === "lan" ? t("settings.status.lanOpen") : t("settings.status.loopbackOnly"),
										n: String(status.activeDevices),
									}),
								)
							: null,
					)
				: null,
		),
		createElement("p", { style: muted }, t("settings.intro")),
		flowStep === 4
			? createElement("p", { style: { ...muted, color: "var(--dshmr-ok)" }, role: "status" }, t("settings.flow.completed"))
			: flowStep === 3
				? createElement("p", { style: muted, role: "status" }, t("settings.flow.nameHint"))
				: null,
		status?.compatibility !== undefined
			? createElement(
					"details",
					{ style: { ...box, padding: "10px 12px" } },
					createElement(
						"summary",
						{
							style: {
								cursor: "pointer",
								fontWeight: 600,
								color:
									status.compatibility.status === "incompatible"
										? "var(--dshmr-danger)"
										: status.compatibility.status === "degraded"
											? "var(--dshmr-warn)"
											: "inherit",
							},
						},
						status.compatibility.status === "incompatible"
							? t("settings.compatibility.incompatible")
							: status.compatibility.status === "degraded"
								? t("settings.compatibility.degraded")
								: status.compatibility.apiProxy.available && status.compatibility.webServer.available
									? t("settings.compatibility.ready")
									: t("settings.compatibility.missing", {
										services: [
											...(status.compatibility.apiProxy.available ? [] : ["apiProxy"]),
											...(status.compatibility.webServer.available ? [] : ["webServer"]),
										].join(", "),
									}),
					),
					createElement(
						"dl",
						{ style: { display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: "5px 12px", margin: "8px 0 0", fontSize: "12px" } },
						createElement("dt", null, t("settings.compatibility.dshVersion")),
						createElement("dd", { style: { margin: 0, wordBreak: "break-all" } }, status.compatibility.dshVersion ?? t("settings.compatibility.unknown")),
						createElement("dt", null, t("settings.compatibility.coreAbi")),
						createElement("dd", { style: { margin: 0, wordBreak: "break-all" } }, status.compatibility.coreAbi ?? t("settings.compatibility.unknown")),
						createElement("dt", null, t("settings.compatibility.accessMode")),
						createElement("dd", { style: { margin: 0 } }, status.accessMode === undefined ? t("settings.compatibility.unknown") : t(`settings.accessMode.${status.accessMode}`)),
					),
					status.compatibility.capabilities === undefined
						? null
						: createElement(
								"ul",
								{ style: { ...muted, margin: "8px 0 0", paddingLeft: "18px" } },
								...Object.entries(status.compatibility.capabilities).map(([name, capability]) =>
									createElement(
										"li",
										{ key: name },
										`${name}: ${capability.state} · ${capability.contract}${capability.reason === undefined ? "" : ` · ${capability.reason}`}`,
									),
								),
							),
					status.compatibility.ownerRequest?.diagnostics.some((item) => item.level === "error")
						? createElement(
								"p",
								{ style: errStyle, role: "alert" },
								status.compatibility.ownerRequest.diagnostics
									.filter((item) => item.level === "error")
									.map((item) => item.message)
									.join(" · "),
							)
						: null,
					status.compatibility.recommendations?.length
						? createElement(
								"ul",
								{ style: { ...muted, margin: "8px 0 0", paddingLeft: "18px" } },
								...status.compatibility.recommendations.map((recommendation) =>
									createElement("li", { key: recommendation }, recommendation),
								),
							)
						: null,
				)
			: null,
		createElement(
			"div",
			{ style: box },
			createElement("strong", { style: { fontSize: "14px" } }, t("settings.channel.title")),
			createElement(
				"label",
				{ style: { display: "flex", gap: "8px", alignItems: "center", fontSize: "13px" } },
				createElement("input", {
					type: "radio",
					name: "channel",
					checked: lanMode,
					onClick: () => setChannelChosen(true),
					onChange: selectLan,
				}),
				t("settings.channel.lan"),
			),
			createElement(
				"label",
				{ style: { display: "flex", gap: "8px", alignItems: "center", fontSize: "13px" } },
				createElement("input", {
					type: "radio",
					name: "channel",
					checked: publicMode,
					onClick: () => setChannelChosen(true),
					onChange: () => {
						setChannel("public");
						if (status?.relay?.running) void relayAction("stop");
					},
				}),
				t("settings.channel.public"),
			),
			createElement(
				"label",
				{ style: { display: "flex", gap: "8px", alignItems: "center", fontSize: "13px" } },
				createElement("input", {
					type: "radio",
					name: "channel",
					checked: relayMode,
					onClick: () => setChannelChosen(true),
					onChange: () => {
						setChannel("relay");
						if (status?.tunnel.running) void tunnelAction("stop");
					},
				}),
				t("settings.channel.relay"),
			),
			channelError !== null ? createElement("p", { style: errStyle }, channelError) : null,
			publicMode
				? createElement("p", { style: warnStyle }, t("settings.channel.publicHint"))
				: null,
			publicMode && !tunnelBinaryOk
				? createElement(
						"div",
						{ style: { display: "grid", gap: "6px" } },
						createElement("p", { style: errStyle }, t("settings.channel.needBinary")),
						createElement(
							"button",
							{
								type: "button",
								disabled: installBusy,
								onClick: installCloudflared,
								style: { justifySelf: "start" },
							},
							installBusy ? t("settings.channel.downloading") : t("settings.channel.downloadBinary"),
						),
					)
				: null,
			publicMode && tunnelBinaryOk && !tunnelRunning
				? createElement("p", { style: muted }, t("settings.channel.nextOffer"))
				: null,
			tunnelRunning
				? createElement(
						"div",
						{ style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" } },
						createElement("span", { style: { fontSize: "13px" } }, t("settings.channel.publicOpen", { host: tunnelHost ?? t("settings.channel.running") })),
						createElement(
							"button",
							{ type: "button", disabled: tunnelBusy, onClick: () => void tunnelAction("stop") },
							t("settings.channel.stopPublic"),
						),
					)
				: null,
			relayMode
				? createElement(
						"p",
						{ style: warnStyle },
						t("settings.channel.relayHint"),
					)
				: null,
			relayMode
				? createElement(
						"div",
						{ style: { display: "grid", gap: "6px" } },
						createElement("input", {
							type: "url",
							value: relayOrigin,
							placeholder: "https://your-relay.example.com",
							onChange: (event: { target: { value: string } }) => setRelayOrigin(event.target.value),
							style: { fontSize: "13px", padding: "6px 8px" },
						}),
						createElement("input", {
							type: "password",
							value: relayToken,
							placeholder: status?.relay?.hasToken ? t("settings.channel.tokenSaved") : "HOST_TOKEN",
							onChange: (event: { target: { value: string } }) => setRelayToken(event.target.value),
							style: { fontSize: "13px", padding: "6px 8px" },
						}),
						relayConnected
							? createElement(
									"div",
									{ style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" } },
									createElement("span", { style: { fontSize: "13px" } }, t("settings.channel.relayConnectedLine", { host: relayHost ?? t("settings.channel.running") })),
									createElement(
										"button",
										{ type: "button", disabled: relayBusy, onClick: () => void relayAction("stop") },
										t("settings.channel.disconnectRelay"),
									),
								)
							: createElement(
									"button",
									{
										type: "button",
										disabled: relayBusy || relayOrigin.trim().length === 0,
										onClick: () => void relayAction("start"),
										style: { justifySelf: "start" },
									},
									relayBusy ? t("settings.channel.connecting") : t("settings.channel.connectRelay"),
								),
					)
				: null,
		),
		createElement(
			"div",
			{ style: box },
			createElement("strong", { style: { fontSize: "14px" } }, t("settings.offer.title")),
			createElement(
				"button",
				{
					type: "button",
					disabled:
						tunnelBusy ||
						relayBusy ||
						installBusy ||
						(publicMode && !tunnelBinaryOk) ||
						(relayMode && !relayConnected && relayOrigin.trim().length === 0),
					onClick: createOffer,
					style: { justifySelf: "start" },
				},
				tunnelBusy || relayBusy ? t("settings.offer.preparing") : t("settings.offer.generate"),
			),
			offerError !== null ? createElement("p", { style: errStyle }, offerError) : null,
			offerInfo !== null
				? createElement(
						"div",
						{ style: { display: "grid", gap: "8px", opacity: offerExpired ? 0.55 : 1 } },
						createElement("p", { style: muted }, t("settings.offer.scanHint")),
						formattedPin.length > 0
							? createElement(
									"div",
									{ style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" } },
									createElement(
										"p",
										{
											style: {
												margin: 0,
												fontSize: "28px",
												letterSpacing: "0.14em",
												fontWeight: 700,
												fontVariantNumeric: "tabular-nums",
											},
										},
										formattedPin,
									),
									createElement(
										"button",
										{
											type: "button",
											onClick: () => {
												void copyText(formattedPin).then((ok) => {
													showCopyToast(ok ? t("settings.offer.copiedPin") : t("common.copyFailed"));
												});
											},
										},
										t("settings.offer.copyPin"),
									),
								)
							: null,
						createElement(
							"div",
							{ style: { position: "relative", display: "inline-block", alignSelf: "start" } },
							createElement("div", {
								style: {
									background: "#ffffff",
									padding: "16px",
									borderRadius: "12px",
									display: "inline-block",
									lineHeight: 0,
								},
							},
								createElement("canvas", {
									id: "dsh-mobile-remote-qr",
									style: { width: "220px", height: "220px", imageRendering: "pixelated", display: "block" },
								}),
							),
							offerExpired
								? createElement(
										"div",
										{
											style: {
												position: "absolute",
												inset: 0,
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												background: "rgba(0,0,0,0.55)",
												borderRadius: "12px",
												color: "#fff",
												fontSize: "14px",
												fontWeight: 600,
											},
										},
										t("common.expired"),
									)
								: null,
						),
						remainingMs !== null
							? createElement(
									"div",
									{ style: { display: "grid", gap: "4px", maxWidth: "16rem" } },
									createElement(
										"p",
										{
											style: {
												margin: 0,
												fontSize: "13px",
												color: progressUrgent ? "#b45309" : undefined,
											},
										},
										offerExpired ? t("settings.offer.pinExpired") : t("common.remaining", { time: formatRemaining(remainingMs) }),
									),
									createElement("div", {
										style: {
											height: "4px",
											borderRadius: "999px",
											background: "rgba(127,127,127,0.25)",
											overflow: "hidden",
										},
									},
										createElement("div", {
											style: {
												height: "100%",
												width: `${String(progressPct)}%`,
												background: progressUrgent ? "#b45309" : "var(--dshmr-ok, #15803d)",
												transition: "width 1s linear",
											},
										}),
									),
								)
							: null,
						createElement(
							"div",
							{ style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
							createElement(
								"button",
								{
									type: "button",
									onClick: () => setShowOfferText((value) => !value),
								},
								showOfferText ? t("settings.offer.hideLink") : t("settings.offer.showLink"),
							),
							createElement(
								"button",
								{
									type: "button",
									onClick: () => {
										void copyText(offerInfo.qrText).then((ok) => {
											showCopyToast(ok ? t("settings.offer.copiedLink") : t("common.copyFailed"));
										});
									},
								},
								t("settings.offer.copyLink"),
							),
							offerExpired
								? createElement(
										"button",
										{
											type: "button",
											onClick: createOffer,
										},
										t("settings.offer.regenerate"),
									)
								: null,
						),
						showOfferText
							? createElement("code", { style: { wordBreak: "break-all", fontSize: "12px" } }, offerInfo.qrText)
							: null,
					)
				: null,
		),
		createElement(
			"div",
			{ style: box },
			createElement("strong", { style: { fontSize: "14px" } }, t("settings.devices.title")),
			devicesState === "loading"
				? createElement("p", { style: muted, role: "status" }, t("common.loading"))
				: devicesState === "permissionDenied" || devicesState === "unavailable"
					? createElement(
							"div",
							{ style: { display: "grid", gap: "6px" }, role: devicesState === "permissionDenied" ? "alert" : "status" },
							createElement("p", { style: errStyle }, t(`settings.state.${devicesState}`)),
							devicesError === null ? null : createElement("p", { style: errStyle }, devicesError),
							createElement("button", { type: "button", onClick: refreshDevices, style: { justifySelf: "start" } }, t("common.retry")),
						)
					: devices.length === 0
				? createElement("p", { style: muted }, t("settings.devices.empty"))
				: createElement(
						"ul",
						{ style: { margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "8px" } },
						...devices.map((device) => {
							const revoked = device.revokedAt !== undefined;
							const online = !revoked && deviceOnline(device.lastSeenAt);
							const pending = revokePendingId === device.deviceId;
							const deviceName = device.displayName?.trim();
							const deviceDetails = t("settings.devices.phoneLine", {
								ago: formatAgo(device.lastSeenAt),
								id: device.deviceId.slice(0, 8),
							});
							return createElement(
								"li",
								{
									key: device.deviceId,
									style: {
										display: "flex",
										gap: "8px",
										alignItems: "center",
										justifyContent: "space-between",
										fontSize: "13px",
										flexWrap: "wrap",
									},
								},
								createElement(
									"span",
									{ style: { wordBreak: "break-all", flex: "1 1 auto", display: "grid", gap: "3px" } },
									createElement(
										"span",
										null,
										createElement(
											"span",
											{
												style: {
													display: "inline-block",
													fontSize: "11px",
													padding: "1px 6px",
													borderRadius: "999px",
													marginRight: "6px",
													background: revoked ? "rgba(127,127,127,0.2)" : online ? "rgba(34,197,94,0.2)" : "rgba(127,127,127,0.15)",
													color: revoked ? "inherit" : online ? "#15803d" : "inherit",
												},
											},
											revoked ? t("settings.devices.revoked") : online ? t("settings.devices.online") : t("settings.devices.offline"),
										),
										deviceName || deviceDetails,
									),
									deviceName ? createElement("span", { style: muted }, deviceDetails) : null,
								),
								!revoked
									? createElement(
											"div",
											{ style: { display: "flex", gap: "6px", flex: "0 0 auto" } },
											pending
												? createElement(
														"button",
														{
															type: "button",
															onClick: () => revokeDevice(device.deviceId),
															style: { background: "#b3261e", color: "#fff" },
														},
														t("settings.devices.confirmRevoke"),
													)
												: createElement(
														"button",
														{
															type: "button",
															onClick: () => setRevokePendingId(device.deviceId),
														},
														t("settings.devices.revoke"),
													),
											pending
												? createElement(
														"button",
														{
															type: "button",
															onClick: () => setRevokePendingId(null),
														},
														t("common.cancel"),
													)
												: null,
										)
									: null,
							);
						}),
					),
			devicesState === "stale"
				? createElement(
						"div",
						{ style: { display: "grid", gap: "4px" }, role: "status" },
						createElement("p", { style: warnStyle }, t("settings.state.stale")),
						devicesError === null ? null : createElement("p", { style: warnStyle }, devicesError),
					)
				: null,
		),
	);
}

const installedContexts = new WeakSet<object>();

function isSlotsApi(value: unknown): value is SlotsApi {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as { inject?: unknown; register?: unknown };
	return typeof candidate.inject === "function" && typeof candidate.register === "function";
}

function asDisposer(value: unknown): () => void {
	return typeof value === "function" ? value as () => void : () => undefined;
}

function registerSettingsSlot(slots: SlotsApi): () => void {
	const dispose = slots.inject("settings.section", () =>
		slots.register(
			{
				name: "settings.section",
				id: "mobile-remote",
				order: 90,
				label: () => t("settings.nav"),
			},
			MobileRemoteSettings,
		),
	);
	return asDisposer(dispose);
}

function mountRecoveryEntry(onRetry: () => void): () => void {
	if (typeof document === "undefined") return () => undefined;
	const host = document.createElement("aside");
	host.id = "dsh-mobile-remote-recovery";
	host.setAttribute("aria-label", t("settings.nav"));
	host.style.position = "fixed";
	host.style.right = "16px";
	host.style.bottom = "16px";
	host.style.zIndex = "2147483000";
	host.style.display = "grid";
	host.style.gap = "8px";
	host.style.maxWidth = "min(22rem, calc(100vw - 32px))";
	const trigger = document.createElement("button");
	trigger.type = "button";
	trigger.textContent = t("settings.recovery.open");
	trigger.setAttribute("aria-expanded", "false");
	trigger.setAttribute("aria-controls", "dsh-mobile-remote-recovery-panel");
	trigger.style.padding = "8px 12px";
	trigger.style.borderRadius = "8px";
	trigger.style.outlineOffset = "3px";
	const panel = document.createElement("div");
	panel.id = "dsh-mobile-remote-recovery-panel";
	panel.setAttribute("role", "status");
	panel.hidden = true;
	panel.style.padding = "12px";
	panel.style.border = "1px solid rgba(127,127,127,.35)";
	panel.style.borderRadius = "10px";
	panel.style.background = "Canvas";
	panel.style.color = "CanvasText";
	const message = document.createElement("p");
	message.textContent = t("settings.recovery.message");
	message.style.margin = "0 0 8px";
	const retry = document.createElement("button");
	retry.type = "button";
	retry.textContent = t("common.retry");
	retry.addEventListener("click", onRetry);
	panel.append(message, retry);
	trigger.addEventListener("click", () => {
		panel.hidden = !panel.hidden;
		trigger.setAttribute("aria-expanded", String(!panel.hidden));
		if (!panel.hidden) retry.focus();
		else trigger.focus();
	});
	host.append(trigger, panel);
	document.body.append(host);
	return () => host.remove();
}

export function apply(ctx: ClientApplyContext): void {
	if (typeof ctx !== "object" || ctx === null || installedContexts.has(ctx)) return;
	installedContexts.add(ctx);
	let disposeSlot: () => void = () => undefined;
	let registered = false;
	let disposed = false;
	let disposeRecovery: () => void = () => undefined;

	const attach = (candidate: ClientApplyContext): void => {
		if (disposed || registered || !isSlotsApi(candidate.slots)) return;
		registered = true;
		disposeSlot = registerSettingsSlot(candidate.slots);
		disposeRecovery();
		disposeRecovery = () => undefined;
	};
	const retry = (): void => {
		attach(ctx);
		if (!registered && typeof location !== "undefined") location.reload();
	};
	disposeRecovery = mountRecoveryEntry(retry);
	attach(ctx);
	const disposeWait = typeof ctx.inject === "function"
		? asDisposer(ctx.inject(["slots"], (candidate) => {
			attach(candidate);
			return () => undefined;
		}))
		: () => undefined;
	ctx.effect?.(() => () => {
		disposed = true;
		disposeWait();
		disposeSlot();
		disposeRecovery();
		installedContexts.delete(ctx);
	});
}
