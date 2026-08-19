/**
 * Management-plane routes (mounted on the host `webServer`, loopback-only).
 *
 *   POST /api/mobile-remote/offers  → widen (if needed) + create a pairing offer
 *   GET  /api/mobile-remote/status  → bind / port / listening / devices
 *   GET  /api/mobile-remote/devices → paired device list (never includes tokenHash)
 *   POST /api/mobile-remote/revoke  → revoke a device
 *
 * Every route runs the guard chain in security.ts and writes JSON with the
 * hardening headers. Route disposers are returned for `ctx.effect`.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { encodeOffer, offerQrText } from "../shared/offer.js";
import type { AuditLogger, DeviceRecord, DeviceRegistry, OfferRegistry } from "./registry.js";
import {
	isTrustedManagementRequest,
	passesBrowserContextGuard,
	passesCsrfGuard,
	readJsonBody,
	writeJson,
} from "./security.js";

export interface ExactWebServer {
	register(route: {
		readonly kind: "exact";
		readonly path: string;
		readonly handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;
	}): () => void;
}

export interface ManagementLogger {
	warn(message: string): void;
	info(message: string): void;
}

export interface AdvertiseResult {
	readonly endpoint: string;
	readonly pageUrl: string;
	readonly candidates: string[];
}

export interface ManagementDeps {
	readonly logger: ManagementLogger;
	readonly now: () => number;
	readonly publicKeyB64: string;
	readonly offerTtlMs: number;
	readonly registry: DeviceRegistry;
	readonly offers: OfferRegistry;
	readonly audit: AuditLogger;
	listening(): boolean;
	currentBind(): string;
	port(): number;
	/** Host names allowed in addition to loopback when the peer is loopback. */
	readonly trustedHosts: readonly string[];
	/** Rebind the data plane to 0.0.0.0 and persist networkReach=lan. */
	widen(): Promise<void>;
	/** Compute endpoint / pageUrl / candidate addresses for the current bind. */
	advertise(): AdvertiseResult;
}

export interface PublicDevice {
	readonly deviceId: string;
	readonly createdAt: number;
	readonly lastSeenAt: number;
	readonly revokedAt?: number;
	readonly scope: DeviceRecord["scope"];
}

/** Public device row. Never includes `tokenHash` or other secrets. */
export function serializeDevice(device: DeviceRecord): PublicDevice {
	return {
		deviceId: device.deviceId,
		createdAt: device.createdAt,
		lastSeenAt: device.lastSeenAt,
		...(device.revokedAt === undefined ? {} : { revokedAt: device.revokedAt }),
		scope: device.scope,
	};
}

export function devicesResponseBody(registry: DeviceRegistry): { devices: PublicDevice[] } {
	return { devices: registry.devices.map(serializeDevice) };
}

function reject(
	response: ServerResponse,
	status: number,
	code: string,
	message: string,
): void {
	writeJson(response, status, { ok: false, error: { code, message } });
}

function guard(
	request: IncomingMessage,
	response: ServerResponse,
	method: string,
	trustedHosts: readonly string[],
): boolean {
	if (!isTrustedManagementRequest(request, trustedHosts)) {
		reject(response, 403, "forbidden", "management API is available only on loopback");
		return false;
	}
	if (!passesBrowserContextGuard(request)) {
		reject(response, 403, "forbidden", "request failed the browser-context guard");
		return false;
	}
	if (method !== "GET" && !passesCsrfGuard(request)) {
		reject(response, 403, "csrf-rejected", "request failed the mutation guard");
		return false;
	}
	return true;
}

export function registerManagementRoutes(
	webServer: ExactWebServer,
	deps: ManagementDeps,
): readonly (() => void)[] {
	const register = (
		path: string,
		methods: readonly string[],
		handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
	): (() => void) =>
		webServer.register({
			kind: "exact",
			path,
			handler: async (request, response) => {
				if (!guard(request, response, request.method ?? "GET", deps.trustedHosts)) return;
				if (!methods.includes(request.method ?? "")) {
					response.setHeader("allow", methods.join(", "));
					reject(response, 405, "method-not-allowed", "request method is not supported");
					return;
				}
				try {
					await handler(request, response);
				} catch (error) {
					deps.logger.warn("management request failed (details redacted)");
					reject(response, 500, "internal", "management request failed");
				}
			},
		});

	return [
		register("/api/mobile-remote/offers", ["POST"], async (request, response) => {
			const body = await readJsonBody(request, response);
			if (body === undefined) return;
			await deps.widen();
			const { endpoint, pageUrl, candidates } = deps.advertise();
			const offer = deps.offers.createOffer({
				endpoint,
				pageUrl,
				publicKeyB64: deps.publicKeyB64,
				ttlMs: deps.offerTtlMs,
				now: deps.now(),
			});
			deps.audit.log({ event: "offer_created", detail: { offerId: offer.offerId } }, deps.now());
			writeJson(response, 200, { offer, qrText: offerQrText(pageUrl, encodeOffer(offer)), candidates });
		}),
		register("/api/mobile-remote/status", ["GET"], async (_request, response) => {
			writeJson(response, 200, {
				enabled: true,
				bind: deps.currentBind(),
				port: deps.port(),
				listening: deps.listening(),
				networkReach: deps.registry.networkReach,
				activeDevices: deps.registry.activeDeviceCount(),
			});
		}),
		register("/api/mobile-remote/devices", ["GET"], async (_request, response) => {
			writeJson(response, 200, devicesResponseBody(deps.registry));
		}),
		register("/api/mobile-remote/revoke", ["POST"], async (request, response) => {
			const body = await readJsonBody(request, response);
			if (body === undefined) return;
			const record = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
			const deviceId = record?.deviceId;
			if (typeof deviceId !== "string" || deviceId.length === 0) {
				reject(response, 400, "invalid_params", "deviceId is required");
				return;
			}
			const revoked = deps.registry.revoke(deviceId, deps.now());
			if (revoked === null) {
				reject(response, 404, "not-found", "device not found");
				return;
			}
			deps.audit.log({ event: "device_revoked", deviceId }, deps.now());
			writeJson(response, 200, { ok: true });
		}),
	];
}
