import { createElement, useEffect, useState } from "react";
import qrcode from "qrcode-generator";

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
}

interface OfferInfo {
	qrText: string;
	candidates: string[];
	expiresAt: number;
}

interface DeviceInfo {
	deviceId: string;
	createdAt: number;
	lastSeenAt: number;
	revokedAt?: number;
	scope: string;
}

function renderQr(qrText: string): void {
	const canvas = document.getElementById("dsh-mobile-remote-qr") as HTMLCanvasElement | null;
	if (canvas === null) return;
	const qr = qrcode(0, "M");
	qr.addData(qrText);
	qr.make();
	const cellSize = 4;
	const count = qr.getModuleCount();
	canvas.width = count * cellSize;
	canvas.height = count * cellSize;
	const context = canvas.getContext("2d");
	if (context === null) return;
	qr.renderTo2dContext(context, cellSize);
}

function formatRemaining(ms: number): string {
	const total = Math.max(0, Math.ceil(ms / 1000));
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function MobileRemoteSettings() {
	const [status, setStatus] = useState<StatusInfo | null>(null);
	const [offerInfo, setOfferInfo] = useState<OfferInfo | null>(null);
	const [devices, setDevices] = useState<DeviceInfo[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [remainingMs, setRemainingMs] = useState<number | null>(null);

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

	const refreshStatus = () => {
		void (async () => {
			try {
				const response = await fetch("/api/mobile-remote/status", {
					headers: { "x-dsh-mobile-remote": "1" },
				});
				const payload = (await response.json()) as StatusInfo & { error?: { message?: string } };
				if (!response.ok || typeof payload.bind !== "string") {
					setError(formatApiError(response, payload, "无法读取移动远程状态"));
					return;
				}
				setStatus(payload);
			} catch {
				setError("无法读取移动远程状态");
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
					setError(formatApiError(response, payload, "无法读取已配对设备"));
					return;
				}
				setDevices(Array.isArray(payload.devices) ? payload.devices : []);
			} catch {
				setError("无法读取已配对设备");
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
		setError(null);
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
					setError("吊销设备失败");
					return;
				}
				refreshDevices();
				refreshStatus();
			} catch {
				setError("吊销设备失败");
			}
		})();
	};

	const createOffer = () => {
		setError(null);
		void (async () => {
			try {
				const response = await fetch("/api/mobile-remote/offers", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-dsh-mobile-remote": "1",
					},
					body: "{}",
				});
				const payload = (await response.json()) as {
					offer: { expiresAt: number };
					qrText: string;
					candidates: string[];
					error?: { message?: string };
				};
				if (!response.ok) {
					setError(formatApiError(response, payload, "生成配对二维码失败"));
					return;
				}
				setOfferInfo({
					qrText: payload.qrText,
					candidates: payload.candidates,
					expiresAt: payload.offer.expiresAt,
				});
			} catch {
				setError("生成配对二维码失败");
			}
		})();
	};

	const statusLine = status === null
		? "状态加载中…"
		: `绑定 ${status.bind}:${String(status.port)} · ${status.listening ? "监听中" : "未监听"} · ${status.networkReach} · 已配对设备 ${String(status.activeDevices)}`;

	return createElement(
		"section",
		{ style: { display: "grid", gap: "12px", maxWidth: "40rem", lineHeight: 1.55 } },
		createElement("p", { style: { margin: 0 } }, statusLine),
		createElement(
			"button",
			{ type: "button", onClick: createOffer, style: { justifySelf: "start" } },
			"生成配对二维码",
		),
		error !== null
			? createElement("p", { style: { margin: 0, color: "#b3261e" } }, error)
			: null,
		offerInfo !== null
			? createElement(
					"div",
					{ style: { display: "grid", gap: "8px" } },
					createElement("canvas", {
						id: "dsh-mobile-remote-qr",
						style: { width: "220px", height: "220px", imageRendering: "pixelated" },
					}),
					createElement(
						"code",
						{ style: { wordBreak: "break-all", fontSize: "12px" } },
						offerInfo.qrText,
					),
					remainingMs !== null
						? createElement("p", { style: { margin: 0 } }, `二维码剩余有效时间 ${formatRemaining(remainingMs)}`)
						: null,
					createElement(
						"p",
						{ style: { margin: 0, fontSize: "13px", color: "#555" } },
						`候选地址：${offerInfo.candidates.join("、")}`,
					),
				)
			: null,
		createElement("h3", { style: { margin: "8px 0 0", fontSize: "15px" } }, "已配对设备"),
		devices.length === 0
			? createElement("p", { style: { margin: 0, color: "#555", fontSize: "13px" } }, "暂无设备")
			: createElement(
					"ul",
					{ style: { margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "8px" } },
					...devices.map((device) =>
						createElement(
							"li",
							{
								key: device.deviceId,
								style: {
									display: "flex",
									gap: "8px",
									alignItems: "center",
									justifyContent: "space-between",
									fontSize: "13px",
								},
							},
							createElement(
								"span",
								{ style: { wordBreak: "break-all" } },
								`${device.deviceId}${device.revokedAt === undefined ? "" : "（已吊销）"}`,
							),
							device.revokedAt === undefined
								? createElement(
										"button",
										{ type: "button", onClick: () => revokeDevice(device.deviceId) },
										"吊销",
									)
								: null,
						),
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
				label: () => "移动远程 / Mobile Remote",
			},
			MobileRemoteSettings,
		),
	);
}
