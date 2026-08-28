/**
 * Management-plane routes (mounted on the loopback-bound host `webServer`).
 *
 *   POST /api/mobile-remote/offers  → widen (if needed) + create a pairing offer
 *   GET  /api/mobile-remote/status  → bind / port / listening / devices
 *   GET  /api/mobile-remote/devices → paired device list (never includes tokenHash)
 *   POST /api/mobile-remote/revoke  → revoke a device
 *
 * Every route runs the guard chain in security.ts and writes JSON with the
 * hardening headers. Route disposers are returned for `ctx.effect`.
 *
 * DSH `webServer.register` keys exact routes by `(kind, path)` and **ignores
 * HTTP method**. Calling `register()` twice for the same path throws
 * `duplicate exact route` and fail-fasts the whole plugin tree. One path =
 * one register; branch GET/POST inside the handler (405 via `methods`).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { MOBILE_PROTOCOL_VERSION } from "../shared/constants.js";
import { encodeOffer, offerQrText } from "../shared/offer.js";
import type { AuditLogger, DeviceRecord, DeviceRegistry, OfferRegistry } from "./registry.js";
import type { HostCompatibilityDiagnostics } from "./context.js";
import {
	CLOUDFLARED_RELEASE,
	expectedSha256Prefix,
	isBareCommandName,
	redactHomePath,
	resolveExistingBinaryPath,
	verifyCloudflaredBinary,
	type CloudflaredVerifyStatus,
} from "./cloudflared-install.js";
import { sanitizedNetworkCandidates, type SanitizedNetworkCandidate } from "./net.js";
import {
	BinaryUntrustedError,
	resolveCloudflaredBinary,
	type CloudflareQuickTunnelSnapshot,
} from "./tunnel.js";
import { validateRelayStartBody, type RendezvousSnapshot } from "./relay.js";
import { ProtocolValidationError } from "../shared/validation.js";
import {
	LOOPBACK_OWNER_REQUEST_POLICY,
	type OwnerAccessMode,
	type OwnerRequestPolicy,
	passesCsrfGuard,
	readJsonBody,
	writeJson,
} from "./security.js";

/** Logged in tunnel_start audit detail; not persisted. */
export const DISCLAIMER_VERSION = "2025-08-quick-tunnel-v1" as const;

function pluginVersionFromPackage(): string {
	try {
		const require = createRequire(import.meta.url);
		const pkg = require("../../package.json") as { version?: unknown };
		if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
	} catch {
		// fall through
	}
	return "unknown";
}

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
	/** Owner authentication boundary. Defaults to strict loopback-only access. */
	readonly ownerRequestPolicy?: OwnerRequestPolicy;
	/** Rebind the data plane to 0.0.0.0 and persist networkReach=lan. */
	widen(): Promise<void>;
	/** Compute endpoint / pageUrl / candidate addresses for the current bind. */
	advertise(): AdvertiseResult;
	/** Cloudflare Quick Tunnel face (start/stop/snapshot). Present only when the plugin owns one. */
	readonly tunnel: TunnelDeps;
	/** Self-hosted rendezvous Worker (outbound). Mutually exclusive with Quick Tunnel. */
	readonly relay: RelayDeps;
	/** Opt-in official binary install. Must not run at apply() time. */
	installCloudflared(): Promise<{ asset: string; path: string }>;
	readonly compatibility?: HostCompatibilityDiagnostics | (() => HostCompatibilityDiagnostics);
}

export interface TunnelDeps {
	snapshot(): CloudflareQuickTunnelSnapshot;
	start(options: { port: number; timeoutMs?: number }): Promise<string>;
	stop(): Promise<void>;
}

export interface RelayDeps {
	snapshot(): RendezvousSnapshot;
	start(options: { origin?: string; hostToken?: string }): Promise<string>;
	stop(): Promise<void>;
	createInvite(): string;
	advertise(invite: string): { endpoint: string; pageUrl: string; candidates: string[] };
	putInvite(input: { invite: string; expiresAt: number; offerId: string }): Promise<void>;
}

/** Advertise the pairing offer through an active tunnel's public URL. */
export function tunnelAdvertise(url: string): AdvertiseResult {
	const origin = url.replace(/\/+$/, "");
	return {
		endpoint: `${origin.replace(/^https:/u, "wss:")}/m/ws`,
		pageUrl: `${origin}/m/`,
		candidates: [origin.replace(/^https:\/\//u, "")],
	};
}

export interface ConnectionDiagnostics {
	readonly schemaVersion: 1;
	readonly pluginVersion: string;
	readonly protocolVersion: number;
	readonly dataPlane: {
		readonly listening: boolean;
		readonly bind: string;
		readonly port: number;
		readonly networkReach: string;
	};
	readonly pairing: {
		readonly offerActive: boolean;
		readonly pendingOfferCount: number;
	};
	readonly devices: {
		readonly active: number;
		readonly revoked: number;
		readonly total: number;
	};
	readonly networkCandidates: readonly SanitizedNetworkCandidate[];
	readonly tunnel: {
		readonly running: boolean;
		readonly urlHost: string | null;
	};
	readonly cloudflared: {
		readonly resolvedPath: string | null;
		readonly verify: CloudflaredVerifyStatus;
		readonly pinnedRelease: string;
		readonly expectedSha256Prefix: string | null;
	};
	readonly disclaimer: {
		readonly requiredVersion: typeof DISCLAIMER_VERSION;
	};
}

export function requireDisclaimerAccepted(record: Record<string, unknown> | null): boolean {
	return record?.disclaimerAccepted === true;
}

export function buildConnectionDiagnostics(deps: ManagementDeps): ConnectionDiagnostics {
	const devices = deps.registry.devices ?? [];
	const revoked = devices.filter((device) => device.revokedAt !== undefined).length;
	const active = deps.registry.activeDeviceCount();
	const pendingOfferCount = typeof deps.offers.count === "function" ? deps.offers.count() : 0;
	const tunnelSnap = deps.tunnel.snapshot();
	let urlHost: string | null = null;
	if (typeof tunnelSnap.url === "string" && tunnelSnap.url.length > 0) {
		try {
			urlHost = new URL(tunnelSnap.url).host;
		} catch {
			urlHost = null;
		}
	}
	const env = process.env.CLOUDFLARED?.trim();
	let verify: CloudflaredVerifyStatus = "missing";
	let absolute: string | null = null;
	if (typeof env === "string" && env.length > 0 && isBareCommandName(env)) {
		verify = "not-pinned";
	} else {
		const resolved = resolveCloudflaredBinary();
		absolute = resolved === null ? null : resolveExistingBinaryPath(resolved);
		if (absolute === null) {
			verify = resolved === null ? "missing" : "unreadable";
		} else {
			const result = verifyCloudflaredBinary(absolute);
			verify = result.ok ? "ok" : result.status;
		}
	}
	return {
		schemaVersion: 1,
		pluginVersion: pluginVersionFromPackage(),
		protocolVersion: MOBILE_PROTOCOL_VERSION,
		dataPlane: {
			listening: deps.listening(),
			bind: deps.currentBind(),
			port: deps.port(),
			networkReach: deps.registry.networkReach,
		},
		pairing: {
			offerActive: pendingOfferCount > 0,
			pendingOfferCount,
		},
		devices: {
			active,
			revoked,
			total: devices.length,
		},
		networkCandidates: sanitizedNetworkCandidates(),
		tunnel: {
			running: tunnelSnap.running,
			urlHost,
		},
		cloudflared: {
			resolvedPath: redactHomePath(absolute),
			verify,
			pinnedRelease: CLOUDFLARED_RELEASE,
			expectedSha256Prefix: expectedSha256Prefix(),
		},
		disclaimer: {
			requiredVersion: DISCLAIMER_VERSION,
		},
	};
}

export interface PublicDevice {
	readonly deviceId: string;
	readonly displayName?: string;
	readonly createdAt: number;
	readonly lastSeenAt: number;
	readonly revokedAt?: number;
	readonly scope: DeviceRecord["scope"];
}

/** Public device row. Never includes `tokenHash` or other secrets. */
export function serializeDevice(device: DeviceRecord): PublicDevice {
	return {
		deviceId: device.deviceId,
		...(device.displayName === undefined ? {} : { displayName: device.displayName }),
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
	ownerRequestPolicy: OwnerRequestPolicy,
): OwnerAccessMode | null {
	let decision;
	try {
		decision = ownerRequestPolicy.authorize(request);
	} catch {
		reject(response, 403, "forbidden", "owner request policy rejected the request");
		return null;
	}
	if (!decision.authorized) {
		reject(response, 403, "forbidden", "owner authorization is required");
		return null;
	}
	if (method !== "GET" && !passesCsrfGuard(request)) {
		reject(response, 403, "csrf-rejected", "request failed the mutation guard");
		return null;
	}
	return decision.accessMode;
}

/**
 * DSH rejects a duplicate path while registering. Keep the route group atomic:
 * if any later registration fails, release every earlier exact route before
 * surfacing the original failure to the plugin entry boundary.
 */
function registerAtomically(factories: readonly (() => () => void)[], logger: ManagementLogger): readonly (() => void)[] {
	const disposers: (() => void)[] = [];
	try {
		for (const factory of factories) disposers.push(factory());
		return disposers;
	} catch (error) {
		for (const dispose of disposers.reverse()) {
			try {
				dispose();
			} catch {
				logger.warn("management route rollback failed (details redacted)");
			}
		}
		throw error;
	}
}

export function registerManagementRoutes(
	webServer: ExactWebServer,
	deps: ManagementDeps,
): readonly (() => void)[] {
	const register = (
		path: string,
		methods: readonly string[],
		handler: (
			request: IncomingMessage,
			response: ServerResponse,
			accessMode: OwnerAccessMode,
		) => void | Promise<void>,
	): (() => void) =>
		webServer.register({
			kind: "exact",
			path,
			handler: async (request, response) => {
				const accessMode = guard(
					request,
					response,
					request.method ?? "GET",
					deps.ownerRequestPolicy ?? LOOPBACK_OWNER_REQUEST_POLICY,
				);
				if (accessMode === null) return;
				if (!methods.includes(request.method ?? "")) {
					response.setHeader("allow", methods.join(", "));
					reject(response, 405, "method-not-allowed", "request method is not supported");
					return;
				}
				try {
					await handler(request, response, accessMode);
				} catch (error) {
					deps.logger.warn("management request failed (details redacted)");
					reject(response, 500, "internal", "management request failed");
				}
			},
		});

	return registerAtomically([
		() => register("/api/mobile-remote/offers", ["POST"], async (request, response) => {
			const body = await readJsonBody(request, response);
			if (body === undefined) return;
			// When the user has an explicit public tunnel running, path /m and /m/ws
			// are already reachable at its HTTPS origin — do NOT rebind/widen to the LAN,
			// and advertise the tunnel URL instead of local candidates.
			const relaySnapshot = deps.relay.snapshot();
			const snapshot = deps.tunnel.snapshot();
			let advertiseResult: AdvertiseResult;
			let pendingInvite: { invite: string; offerId: string; expiresAt: number } | null = null;
			if (relaySnapshot.running) {
				if (!relaySnapshot.hostConnected || relaySnapshot.url === null) {
					reject(response, 503, "relay-not-connected", "rendezvous host is not connected");
					return;
				}
				const invite = deps.relay.createInvite();
				advertiseResult = deps.relay.advertise(invite);
				const createdRelay = deps.offers.createOffer({
					endpoint: advertiseResult.endpoint,
					pageUrl: advertiseResult.pageUrl,
					publicKeyB64: deps.publicKeyB64,
					ttlMs: deps.offerTtlMs,
					now: deps.now(),
				});
				pendingInvite = { invite, offerId: createdRelay.offer.offerId, expiresAt: createdRelay.offer.expiresAt };
				const { offer, pairCode } = createdRelay;
				deps.audit.log({ event: "offer_created", detail: { offerId: offer.offerId } }, deps.now());
				try {
					await deps.relay.putInvite(pendingInvite);
				} catch {
					reject(response, 503, "relay-not-connected", "failed to register invite with the rendezvous");
					return;
				}
				writeJson(response, 200, {
					offer,
					pairCode,
					qrText: offerQrText(advertiseResult.pageUrl, encodeOffer(offer)),
					candidates: advertiseResult.candidates,
				});
				return;
			}
			if (snapshot.running && snapshot.url !== null) {
				advertiseResult = tunnelAdvertise(snapshot.url);
			} else {
				await deps.widen();
				advertiseResult = deps.advertise();
			}
			const { endpoint, pageUrl, candidates } = advertiseResult;
			const created = deps.offers.createOffer({
				endpoint,
				pageUrl,
				publicKeyB64: deps.publicKeyB64,
				ttlMs: deps.offerTtlMs,
				now: deps.now(),
			});
			const { offer, pairCode } = created;
			deps.audit.log({ event: "offer_created", detail: { offerId: offer.offerId } }, deps.now());
			writeJson(response, 200, {
				offer,
				pairCode,
				qrText: offerQrText(pageUrl, encodeOffer(offer)),
				candidates,
			});
		}),
		() => register("/api/mobile-remote/status", ["GET"], async (_request, response, accessMode) => {
			writeJson(response, 200, {
				enabled: true,
				accessMode,
				bind: deps.currentBind(),
				port: deps.port(),
				listening: deps.listening(),
				networkReach: deps.registry.networkReach,
				activeDevices: deps.registry.activeDeviceCount(),
				tunnel: deps.tunnel.snapshot(),
				relay: deps.relay.snapshot(),
				compatibility: typeof deps.compatibility === "function" ? deps.compatibility() : deps.compatibility,
				connectionDiagnostics: buildConnectionDiagnostics(deps),
			});
		}),
		() => register("/api/mobile-remote/tunnel", ["GET", "POST"], async (request, response) => {
			if ((request.method ?? "GET") === "GET") {
				writeJson(response, 200, deps.tunnel.snapshot());
				return;
			}
			const body = await readJsonBody(request, response);
			if (body === undefined) return;
			const record = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
			const action = record?.action;
			const kind = record?.kind;
			if (kind !== "cloudflare-quick") {
				reject(response, 400, "invalid_params", "kind must be 'cloudflare-quick'");
				return;
			}
			if (action === "start") {
				if (record === null || !requireDisclaimerAccepted(record)) {
					deps.audit.log(
						{ event: "tunnel_start_rejected", detail: { reason: "disclaimer_required" } },
						deps.now(),
					);
					reject(response, 400, "disclaimer_required", "disclaimerAccepted must be true to start a Quick Tunnel");
					return;
				}
				try {
					await deps.relay.stop();
					const url = await deps.tunnel.start({ port: deps.port() });
					let host = "trycloudflare.com";
					try {
						host = new URL(url).host;
					} catch {
						// keep placeholder
					}
					deps.audit.log(
						{
							event: "tunnel_start",
							detail: {
								kind: "cloudflare-quick",
								host,
								disclaimerAccepted: true,
								disclaimerVersion: DISCLAIMER_VERSION,
							},
						},
						deps.now(),
					);
					writeJson(response, 200, { ok: true, running: true, url });
				} catch (error) {
					const message = error instanceof Error ? error.message : "start failed";
					const code =
						error instanceof BinaryUntrustedError
							? "binary-untrusted"
							: error instanceof Error && (error as Error & { code?: string }).code === "binary-untrusted"
								? "binary-untrusted"
								: "tunnel-start-failed";
					deps.logger.warn(`cloudflare quick tunnel start failed (${message})`);
					writeJson(response, 500, { ok: false, error: { code, message } });
				}
				return;
			}
			if (action === "stop") {
				await deps.tunnel.stop();
				deps.audit.log({ event: "tunnel_stop", detail: { kind: "cloudflare-quick" } }, deps.now());
				writeJson(response, 200, { ok: true, snapshot: deps.tunnel.snapshot() });
				return;
			}
			reject(response, 400, "invalid_params", "action must be 'start' or 'stop'");
		}),
		() => register("/api/mobile-remote/relay", ["GET", "POST"], async (request, response) => {
			if ((request.method ?? "GET") === "GET") {
				writeJson(response, 200, deps.relay.snapshot());
				return;
			}
			const body = await readJsonBody(request, response);
			if (body === undefined) return;
			const record = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
			const action = record?.action;
			if (action === "start") {
				try {
					const startBody = validateRelayStartBody(record);
					await deps.tunnel.stop();
					const url = await deps.relay.start(startBody);
					let host = "example.com";
					try {
						host = new URL(url).host;
					} catch {
						// keep placeholder
					}
					deps.audit.log({ event: "relay_start", detail: { host } }, deps.now());
					writeJson(response, 200, { ok: true, running: true, url, snapshot: deps.relay.snapshot() });
				} catch (error) {
					if (error instanceof ProtocolValidationError) {
						reject(response, 400, "invalid_params", error.message);
						return;
					}
					const message = error instanceof Error ? error.message : "start failed";
					deps.logger.warn(`rendezvous start failed (${message})`);
					writeJson(response, 500, { ok: false, error: { code: "relay-start-failed", message } });
				}
				return;
			}
			if (action === "stop") {
				await deps.relay.stop();
				deps.audit.log({ event: "relay_stop", detail: { kind: "rendezvous" } }, deps.now());
				writeJson(response, 200, { ok: true, snapshot: deps.relay.snapshot() });
				return;
			}
			reject(response, 400, "invalid_params", "action must be 'start' or 'stop'");
		}),
		() => register("/api/mobile-remote/devices", ["GET"], async (_request, response) => {
			writeJson(response, 200, devicesResponseBody(deps.registry));
		}),
		() => register("/api/mobile-remote/cloudflared", ["POST"], async (request, response) => {
			const body = await readJsonBody(request, response);
			if (body === undefined) return;
			const record = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
			if (record?.action !== "install") {
				reject(response, 400, "invalid_params", "action must be 'install'");
				return;
			}
			try {
				const result = await deps.installCloudflared();
				deps.audit.log({ event: "cloudflared_install", detail: { asset: result.asset } }, deps.now());
				writeJson(response, 200, { ok: true, asset: result.asset });
			} catch (error) {
				const message = error instanceof Error ? error.message : "install failed";
				deps.logger.warn(`cloudflared install failed (${message})`);
				writeJson(response, 500, { ok: false, error: { code: "install-failed", message } });
			}
		}),
		() => register("/api/mobile-remote/revoke", ["POST"], async (request, response) => {
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
	], deps.logger);
}
