import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { base64Encode } from "../shared/base64.js";
import { type RuntimeConfig, RuntimeConfigSchema } from "./config.js";
import { createOwnerRequestPolicy, safeguardOwnerRequestPolicy, type OwnerRequestDiagnostic } from "./security.js";
import { resolveHostCompatibility, type MobileRemoteHostContext } from "./context.js";
import { MobileDataPlane } from "./dataplane.js";
import { loadOrCreateServerKey } from "./keys.js";
import { networkCandidates } from "./net.js";
import { AuditLogger, DeviceRegistry, OfferRegistry } from "./registry.js";
import { ensureStorageDir } from "./storage.js";
import { registerManagementRoutes } from "./routes.js";
import { installOfficialCloudflared } from "./cloudflared-install.js";
import { CloudflareQuickTunnel } from "./tunnel.js";
import { RendezvousClient } from "./relay.js";
import { createUpstreamHub } from "./upstream.js";

export const name = "mobile-remote";

// Only the management-plane web server is a hard host dependency. apiProxy is
// capability-detected so installs that lack session RPC still load safely.
export const inject = ["webServer"] as const;

export const Config = RuntimeConfigSchema;

const LOOPBACK = "127.0.0.1";
const ALL_INTERFACES = "0.0.0.0";

/** Plugin entry boundary: DSH fails the entire plugin tree on an uncaught import/apply error. */
export async function apply(ctx: MobileRemoteHostContext, rawConfig: unknown): Promise<void> {
	try {
		await applyRuntime(ctx, rawConfig);
	} catch (error) {
		const kind = error instanceof Error ? error.name : "error";
		try {
			ctx.logger.error(`mobile-remote failed to load safely (${kind}); no compatibility exception escaped the plugin entry`);
		} catch {
			// Logging is host-controlled; it must not turn a recovered load failure into a fatal one.
		}
	}
}

async function applyRuntime(ctx: MobileRemoteHostContext, rawConfig: unknown): Promise<void> {
	const config: RuntimeConfig = RuntimeConfigSchema.parse(rawConfig ?? {});
	const { logger } = ctx;
	const cleanupSteps: Array<() => void | Promise<void>> = [];
	let cleanupStarted = false;
	const cleanupRuntime = async (): Promise<void> => {
		if (cleanupStarted) return;
		cleanupStarted = true;
		for (const cleanup of cleanupSteps.reverse()) {
			try {
				await cleanup();
			} catch {
				logger.warn("mobile-remote runtime cleanup failed (details redacted)");
			}
		}
	};
	logger.info(
		`mobile-remote loaded, enabled=${String(config.enabled)}, bind=${config.bind}, port=${String(config.port)}`,
	);
	if (!config.enabled) {
		logger.info("mobile-remote is disabled; no services started");
		return;
	}

	const storageDirectory = ensureStorageDir();
	const serverKeyPair = loadOrCreateServerKey(storageDirectory);
	const registry = new DeviceRegistry(storageDirectory);
	const offers = new OfferRegistry();
	const audit = new AuditLogger(storageDirectory);

	// Cloudflare Quick Tunnel for the data plane only (never 3080). Persisted so a
	// fresh instance can detect (and clear) a stale dead child after a crash.
	const tunnel = new CloudflareQuickTunnel({
		persistFile: join(storageDirectory, "tunnel.json"),
	});
	cleanupSteps.push(() => tunnel.stop());

	const host = resolveHostCompatibility(ctx);
	const fallbackOwnerRequestPolicy = createOwnerRequestPolicy(config.ownerRequest);
	const ownerRequestPolicy = safeguardOwnerRequestPolicy(host.ownerRequestPolicy ?? fallbackOwnerRequestPolicy);
	let ownerRequestDiagnostics: readonly OwnerRequestDiagnostic[] = [];
	try {
		ownerRequestDiagnostics = ownerRequestPolicy.diagnostics();
	} catch {
		ownerRequestDiagnostics = [
			{
				id: "owner-request.diagnostics-unavailable",
				level: "error",
				message: "owner request policy diagnostics are unavailable; requests remain fail closed",
			},
		];
	}
	if (config.trustedHosts.length > 0 && config.ownerRequest.trustedProxy === undefined) {
		logger.warn(
			"mobile-remote: trustedHosts no longer authorizes remote Settings; configure ownerRequest.trustedProxy or use SSH loopback",
		);
	}
	const apiProxy = host.apiProxy;
	if (apiProxy === undefined) {
		logger.warn("mobile-remote: apiProxy service unavailable; session RPC will return upstream_error");
	}
	const upstream = createUpstreamHub(apiProxy, logger);
	cleanupSteps.push(() => upstream.stop());

	const mobileDir = fileURLToPath(new URL("../mobile/", import.meta.url));
	const dataPlane = new MobileDataPlane({
		serverKeyPair,
		registry,
		offers,
		audit,
		logger,
		mobileDir,
		port: config.port,
		upstream,
	});
	cleanupSteps.push(() => dataPlane.close());

	const rendezvous = new RendezvousClient({
		persistFile: join(storageDirectory, "relay.json"),
		logger,
		offers,
		connectionDeps: () => dataPlane.connectionDeps(),
	});
	cleanupSteps.push(() => rendezvous.stop());

	// Startup bind: keep LAN reachability across restarts for active devices.
	const startBind =
		registry.hasActiveDevice() && registry.networkReach === "lan" ? ALL_INTERFACES : config.bind;
	try {
		await dataPlane.listen(startBind);
		logger.info(`mobile-remote data plane listening on ${dataPlane.host}:${String(config.port)}`);
	} catch (error) {
		logger.warn(`mobile-remote data plane failed to listen (${error instanceof Error ? error.name : "error"})`);
		await cleanupRuntime();
		return;
	}

	const widen = async (): Promise<void> => {
		if (dataPlane.host === ALL_INTERFACES) return;
		await dataPlane.listen(ALL_INTERFACES);
		registry.setNetworkReach("lan");
		logger.info("mobile-remote data plane widened to 0.0.0.0 (networkReach=lan)");
	};

	const advertise = () => {
		const candidates = dataPlane.host === ALL_INTERFACES ? networkCandidates() : [LOOPBACK];
		const ip = candidates[0] ?? LOOPBACK;
		return {
			endpoint: `ws://${ip}:${String(config.port)}/m/ws`,
			pageUrl: `http://${ip}:${String(config.port)}/m/`,
			candidates,
		};
	};

	const webServer = host.webServer;
	if (webServer === undefined) {
		logger.warn("mobile-remote: webServer service unavailable; management routes not registered");
	} else {
		let disposers: readonly (() => void)[];
		try {
			disposers = registerManagementRoutes(webServer, {
				logger,
				now: () => Date.now(),
				publicKeyB64: base64Encode(serverKeyPair.publicKey),
				offerTtlMs: config.offerTtlMs,
				registry,
				offers,
				audit,
				ownerRequestPolicy,
				listening: () => dataPlane.listening,
				currentBind: () => dataPlane.host,
				port: () => config.port,
				widen,
				advertise,
				tunnel: {
					snapshot: () => tunnel.snapshot(),
					start: (options) => tunnel.start(options),
					stop: () => tunnel.stop(),
				},
				relay: {
					snapshot: () => rendezvous.snapshot(),
					start: (options) => rendezvous.start(options),
					stop: () => rendezvous.stop(),
					createInvite: () => rendezvous.createInvite(),
					advertise: (invite) => rendezvous.advertise(invite),
					putInvite: (input) => rendezvous.putInvite(input),
				},
				installCloudflared: () => installOfficialCloudflared(),
				compatibility: {
					...host.diagnostics,
					ownerRequest: {
						source: host.ownerRequestPolicy === undefined ? "plugin-fallback" : "host",
						diagnostics: ownerRequestDiagnostics,
					},
				},
			});
		} catch (error) {
			await cleanupRuntime();
			throw error;
		}
		cleanupSteps.push(...disposers);
	}

	try {
		ctx.effect(() => () => cleanupRuntime(), "mobile-remote: atomic runtime group");
	} catch (error) {
		await cleanupRuntime();
		throw error;
	}
}
