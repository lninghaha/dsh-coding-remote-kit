import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { base64Encode } from "../shared/base64.js";
import { type RuntimeConfig, RuntimeConfigSchema } from "./config.js";
import { trustedHostsFromRuntime } from "./security.js";
import { isHostApiProxy, type MobileRemoteHostContext } from "./context.js";
import { MobileDataPlane } from "./dataplane.js";
import { loadOrCreateServerKey } from "./keys.js";
import { networkCandidates } from "./net.js";
import { AuditLogger, DeviceRegistry, OfferRegistry } from "./registry.js";
import { ensureStorageDir } from "./storage.js";
import { registerManagementRoutes } from "./routes.js";
import { CloudflareQuickTunnel } from "./tunnel.js";
import { createUpstreamHub } from "./upstream.js";

export const name = "mobile-remote";

export const inject = ["apiProxy", "webServer"] as const;

export const Config = RuntimeConfigSchema;

const LOOPBACK = "127.0.0.1";
const ALL_INTERFACES = "0.0.0.0";

export async function apply(ctx: MobileRemoteHostContext, rawConfig: unknown): Promise<void> {
	const config: RuntimeConfig = RuntimeConfigSchema.parse(rawConfig ?? {});
	const { logger } = ctx;
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
	ctx.effect(
		() => () => void tunnel.stop(),
		"mobile-remote: cloudflare quick tunnel (must stop on unload)",
	);

	const injected = ctx.apiProxy ?? ctx.get?.("apiProxy");
	const apiProxy = isHostApiProxy(injected) ? injected : undefined;
	if (apiProxy === undefined) {
		logger.warn("mobile-remote: apiProxy service unavailable; session RPC will return upstream_error");
	}
	const upstream = createUpstreamHub(apiProxy, logger);
	ctx.effect(() => () => upstream.stop(), "mobile-remote: upstream hub");

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

	// Startup bind: keep LAN reachability across restarts for active devices.
	const startBind =
		registry.hasActiveDevice() && registry.networkReach === "lan" ? ALL_INTERFACES : config.bind;
	try {
		await dataPlane.listen(startBind);
		logger.info(`mobile-remote data plane listening on ${dataPlane.host}:${String(config.port)}`);
	} catch (error) {
		logger.warn(`mobile-remote data plane failed to listen (${error instanceof Error ? error.name : "error"})`);
		ctx.effect(() => () => void dataPlane.close(), "mobile-remote: data plane");
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

	const webServer = ctx.webServer;
	if (webServer === undefined) {
		logger.warn("mobile-remote: webServer service unavailable; management routes not registered");
	} else {
		const trustedHosts = [...config.trustedHosts, ...trustedHostsFromRuntime(ctx.get?.("webRuntime"))];
		const disposers = registerManagementRoutes(webServer, {
			logger,
			now: () => Date.now(),
			publicKeyB64: base64Encode(serverKeyPair.publicKey),
			offerTtlMs: config.offerTtlMs,
			registry,
			offers,
			audit,
			trustedHosts,
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
		});
		for (const [index, dispose] of disposers.entries()) {
			ctx.effect(() => dispose, `mobile-remote: route ${index + 1}`);
		}
	}

	ctx.effect(() => () => void dataPlane.close(), "mobile-remote: data plane");
}
