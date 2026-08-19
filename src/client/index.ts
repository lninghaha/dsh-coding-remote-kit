import { createElement, useEffect, useState } from "react";
import qrcode from "qrcode-generator";
import { formatPairCode } from "../shared/pair-code.js";

export const inject = ["slots"];

interface SlotsApi {
	inject(name: string, factory: () => unknown): void;
	register(
		options: {
			name: string;
			id: string;
			order?: number;
			label?: string;
		},
		component: unknown,
	): unknown;
}

interface ClientApplyContext {
	slots: SlotsApi;
}

interface StatusInfo {
	enabled: boolean;
	bind: string;
	port: number;
	listening: boolean;
	networkReach: string;
	activeDevices: number;
	tunnel: TunnelSnapshot;
	relay: RelaySnapshot;
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

interface OfferInfo {
	qrText: string;
	candidates: string[];
	expiresAt: number;
	pairCode: string;
	initialRemainingMs: number;
}

interface DeviceInfo {
	deviceId: string;
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

function formatAgo(timestamp: number): string {
	if (timestamp <= 0) return "";
	const delta = Date.now() - timestamp;
	if (delta < 60_000) return "刚刚";
	if (delta < 3_600_000) return `${String(Math.floor(delta / 60_000))} 分钟前`;
	if (delta < 86_400_000) return `${String(Math.floor(delta / 3_600_000))} 小时前`;
	return `${String(Math.floor(delta / 86_400_000))} 天前`;
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

function MobileRemoteSettings() {
	const [status, setStatus] = useState<StatusInfo | null>(null);
	const [channel, setChannel] = useState<Channel>("lan");
	const [offerInfo, setOfferInfo] = useState<OfferInfo | null>(null);
	const [devices, setDevices] = useState<DeviceInfo[]>([]);
	const [statusError, setStatusError] = useState<string | null>(null);
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

	const formatApiError = (
		response: Response,
		payload: { error?: { message?: string } } | null,
		fallback: string,
	): string => {
		const detail = payload?.error?.message;
		if (typeof detail === "string" && detail.length > 0) {
			return `${fallback}（${String(response.status)}: ${detail}）`;
		}
		return `${fallback}（HTTP ${String(response.status)}）`;
	};

	const showCopyToast = (message: string) => {
		setCopyToast(message);
		setTimeout(() => setCopyToast(null), 2000);
	};

	const refreshStatus = () => {
		void (async () => {
			try {
				const response = await fetch("/api/mobile-remote/status", {
					headers: { "x-dsh-mobile-remote": "1" },
				});
				const payload = (await response.json()) as StatusInfo & { error?: { message?: string } };
				if (!response.ok || typeof payload.bind !== "string") {
					setStatusError(formatApiError(response, payload, "无法读取移动远程状态"));
					return;
				}
				setStatusError(null);
				setStatus(payload);
				if (typeof payload.relay?.url === "string" && payload.relay.url.length > 0) {
					setRelayOrigin(payload.relay.url);
				}
			} catch {
				setStatusError("无法读取移动远程状态");
			}
		})();
	};

	const refreshDevices = () => {
		void (async () => {
			try {
				const response = await fetch("/api/mobile-remote/devices", {
					headers: { "x-dsh-mobile-remote": "1" },
				});
				const payload = (await response.json()) as { devices?: DeviceInfo[]; error?: { message?: string } };
				if (!response.ok) {
					setStatusError(formatApiError(response, payload, "无法读取已配对设备"));
					return;
				}
				setDevices(Array.isArray(payload.devices) ? payload.devices : []);
			} catch {
				setStatusError("无法读取已配对设备");
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
					setOfferError("吊销设备失败");
					return;
				}
				setRevokePendingId(null);
				refreshDevices();
				refreshStatus();
			} catch {
				setOfferError("吊销设备失败");
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
						action === "start" ? "开启公网失败" : "停止公网失败",
					),
				);
				return false;
			}
			refreshStatus();
			if (action === "start") setChannel("public");
			if (action === "stop") setChannel("lan");
			return true;
		} catch {
			setChannelError(action === "start" ? "开启公网失败" : "停止公网失败");
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
							"下载官方 cloudflared 失败",
						),
					);
					return;
				}
				refreshStatus();
			} catch {
				setChannelError("下载官方 cloudflared 失败");
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
						action === "start" ? "会合中继连接失败" : "停止会合中继失败",
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
			setChannelError(action === "start" ? "会合中继连接失败" : "停止会合中继失败");
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
		setOfferError(null);
		void (async () => {
			try {
				if (channel === "public") {
					if (!(status?.tunnel.binaryOk ?? false)) {
						setOfferError("请先下载官方 cloudflared");
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
							"生成二维码失败",
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
				setOfferError("生成二维码失败");
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
					...box,
					gridTemplateColumns: "1fr auto",
					alignItems: "center",
					gap: "12px",
				},
			},
			createElement(
				"div",
				{ style: { display: "grid", gap: "4px" } },
				createElement("strong", { style: { fontSize: "14px" } }, "数据面状态"),
				status === null
					? createElement("span", { style: muted }, statusError ?? "正在读取…")
					: createElement(
							"span",
							{ style: { fontSize: "13px" } },
							`${status.listening ? "监听中" : "未监听"} · 端口 ${String(status.port)} · ${status.networkReach === "lan" ? "已开放局域网" : "仅本机回环"} · ${String(status.activeDevices)} 台在线`,
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
				"刷新状态",
			),
			statusError !== null && status === null
				? createElement("p", { style: { ...errStyle, gridColumn: "1 / -1" } }, statusError)
				: null,
		),
		createElement("p", { style: muted }, "用手机浏览器扫码，控制这台电脑上的 DSH。配对码大约 10 分钟有效。"),
		createElement(
			"div",
			{ style: box },
			createElement("strong", { style: { fontSize: "14px" } }, "1. 手机怎么连"),
			createElement(
				"label",
				{ style: { display: "flex", gap: "8px", alignItems: "center", fontSize: "13px" } },
				createElement("input", {
					type: "radio",
					name: "channel",
					checked: lanMode,
					onChange: selectLan,
				}),
				"同一 Wi‑Fi / 局域网",
			),
			createElement(
				"label",
				{ style: { display: "flex", gap: "8px", alignItems: "center", fontSize: "13px" } },
				createElement("input", {
					type: "radio",
					name: "channel",
					checked: publicMode,
					onChange: () => {
						setChannel("public");
						if (status?.relay?.running) void relayAction("stop");
					},
				}),
				"外出（临时公网，不用 Cloudflare 账号）",
			),
			createElement(
				"label",
				{ style: { display: "flex", gap: "8px", alignItems: "center", fontSize: "13px" } },
				createElement("input", {
					type: "radio",
					name: "channel",
					checked: relayMode,
					onChange: () => {
						setChannel("relay");
						if (status?.tunnel.running) void tunnelAction("stop");
					},
				}),
				"会合中继（自建 Worker，本机不开放端口）",
			),
			channelError !== null ? createElement("p", { style: errStyle }, channelError) : null,
			publicMode
				? createElement("p", { style: warnStyle }, "公网地址等于一把临时钥匙，请勿转发。配对仍要扫码。不登录、不使用你的 Cloudflare token。")
				: null,
			publicMode && !tunnelBinaryOk
				? createElement(
						"div",
						{ style: { display: "grid", gap: "6px" } },
						createElement("p", { style: errStyle }, "外出需要官方 cloudflared（约几十 MB，装到本机 ~/.local/bin）。"),
						createElement(
							"button",
							{
								type: "button",
								disabled: installBusy,
								onClick: installCloudflared,
								style: { justifySelf: "start" },
							},
							installBusy ? "正在下载官方组件…" : "下载官方 cloudflared",
						),
					)
				: null,
			publicMode && tunnelBinaryOk && !tunnelRunning
				? createElement("p", { style: muted }, "下一步点「生成二维码」时会自动打开临时公网。")
				: null,
			tunnelRunning
				? createElement(
						"div",
						{ style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" } },
						createElement("span", { style: { fontSize: "13px" } }, `公网已开：${tunnelHost ?? "运行中"}`),
						createElement(
							"button",
							{ type: "button", disabled: tunnelBusy, onClick: () => void tunnelAction("stop") },
							"停止公网",
						),
					)
				: null,
			relayMode
				? createElement(
						"p",
						{ style: warnStyle },
						"需要你自己的 Cloudflare 账号（Workers Paid）部署仓库里的 relay/。中继只转发密文，不要把 3080 指过去。",
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
							placeholder: status?.relay?.hasToken ? "已保存 HOST_TOKEN，留空则沿用" : "HOST_TOKEN",
							onChange: (event: { target: { value: string } }) => setRelayToken(event.target.value),
							style: { fontSize: "13px", padding: "6px 8px" },
						}),
						relayConnected
							? createElement(
									"div",
									{ style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" } },
									createElement("span", { style: { fontSize: "13px" } }, `中继已连：${relayHost ?? "运行中"}`),
									createElement(
										"button",
										{ type: "button", disabled: relayBusy, onClick: () => void relayAction("stop") },
										"断开中继",
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
									relayBusy ? "正在连接…" : "连接会合中继",
								),
					)
				: null,
		),
		createElement(
			"div",
			{ style: box },
			createElement("strong", { style: { fontSize: "14px" } }, "2. 生成二维码或配对码"),
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
				tunnelBusy || relayBusy ? "正在准备…" : "生成二维码",
			),
			offerError !== null ? createElement("p", { style: errStyle }, offerError) : null,
			offerInfo !== null
				? createElement(
						"div",
						{ style: { display: "grid", gap: "8px", opacity: offerExpired ? 0.55 : 1 } },
						createElement("p", { style: muted }, "扫码，或在手机打开配对页后输入配对码。不要发到群里。"),
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
													showCopyToast(ok ? "已复制配对码" : "复制失败");
												});
											},
										},
										"复制配对码",
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
										"已过期",
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
										offerExpired ? "配对码已过期，请重新生成" : `剩余 ${formatRemaining(remainingMs)}`,
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
								showOfferText ? "隐藏链接" : "显示链接",
							),
							createElement(
								"button",
								{
									type: "button",
									onClick: () => {
										void copyText(offerInfo.qrText).then((ok) => {
											showCopyToast(ok ? "已复制完整链接" : "复制失败");
										});
									},
								},
								"复制链接",
							),
							offerExpired
								? createElement(
										"button",
										{
											type: "button",
											onClick: createOffer,
										},
										"重新生成",
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
			createElement("strong", { style: { fontSize: "14px" } }, "3. 已配对的手机"),
			devices.length === 0
				? createElement("p", { style: muted }, "还没有手机连过。")
				: createElement(
						"ul",
						{ style: { margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "8px" } },
						...devices.map((device) => {
							const revoked = device.revokedAt !== undefined;
							const online = !revoked && deviceOnline(device.lastSeenAt);
							const pending = revokePendingId === device.deviceId;
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
									{ style: { wordBreak: "break-all", flex: "1 1 auto" } },
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
										revoked ? "已吊销" : online ? "在线" : "离线",
									),
									`手机 · ${formatAgo(device.lastSeenAt)} · ${device.deviceId.slice(0, 8)}…`,
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
														"确认解除",
													)
												: createElement(
														"button",
														{
															type: "button",
															onClick: () => setRevokePendingId(device.deviceId),
														},
														"解除配对",
													),
											pending
												? createElement(
														"button",
														{
															type: "button",
															onClick: () => setRevokePendingId(null),
														},
														"取消",
													)
												: null,
										)
									: null,
							);
						}),
					),
		),
	);
}

export function apply(ctx: ClientApplyContext): void {
	ctx.slots.inject("settings.section", () =>
		ctx.slots.register(
			{
				name: "settings.section",
				id: "mobile-remote",
				order: 90,
				label: () => "移动远程",
			},
			MobileRemoteSettings,
		),
	);
}
