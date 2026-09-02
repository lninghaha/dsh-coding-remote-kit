/**
 * Mobile data plane: a dedicated `node:http` + `ws` server (default port 6879).
 *
 *   GET /m and /m/*  → static mobile page (no-store)
 *   GET /m/ws        → E2EE WebSocket (the pairing + RPC channel)
 *   everything else  → 404
 *
 * On the wire, encrypted frames travel as base64(sealed) in WS text frames.
 * `e2ee_hello` and `e2ee_ready` are plaintext JSON; everything after the hello
 * is encrypted. Connection governance: 128-connection cap, 15s ping/pong
 * heartbeat, 10s handshake window, 5-strike decryption limit, and per-connection
 * outbound backpressure.
 */

import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { join, normalize, sep } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import {
	CLOSE_OVERLOAD,
	MAX_CONNECTIONS,
	MAX_WS_PAYLOAD,
} from "../shared/constants.js";
import { MOBILE_SHELL_SECURITY_HEADERS } from "../shared/mobile-shell-headers.js";
import { acceptMobileSocket, type ConnectionDeps } from "./connection.js";
import { resolveDeviceToken } from "./e2ee.js";
import type { AuditLogger, DeviceRegistry, OfferRegistry } from "./registry.js";
import { isCompletePairCode, normalizePairCode } from "../shared/pair-code.js";
import { readJsonBody, writeJson } from "./security.js";
import type { UpstreamHub } from "./upstream.js";

export interface DataPlaneLogger {
	debug(message: string): void;
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

export interface DataPlaneDeps {
	readonly serverKeyPair: { readonly secretKey: Uint8Array; readonly publicKey: Uint8Array };
	readonly registry: DeviceRegistry;
	readonly offers: OfferRegistry;
	readonly audit: AuditLogger;
	readonly logger: DataPlaneLogger;
	readonly mobileDir: string;
	readonly port: number;
	readonly upstream: UpstreamHub;
	readonly now?: () => number;
}

/** Resolve a static file under `mobileDir`, or `null` if the path escapes. */
export function resolveMobileStaticPath(mobileDir: string, relative: string): string | null {
	const base = normalize(mobileDir).replace(/[/\\]+$/u, "");
	const filePath = normalize(join(base, relative));
	if (filePath !== base && !filePath.startsWith(base + sep)) return null;
	return filePath;
}

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".mjs": "application/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".webmanifest": "application/manifest+json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".txt": "text/plain; charset=utf-8",
};

export function cacheControlForMobile(relative: string): string {
	if (relative === "sw.js" || relative === "index.html" || relative === "") return "no-store";
	if (relative.endsWith(".png") || relative.endsWith(".webmanifest")) return "public, max-age=86400";
	if (relative === "app.js") return "public, max-age=300";
	return "no-store";
}

export class MobileDataPlane {
	readonly #deps: DataPlaneDeps;
	#server: Server | null = null;
	#wss: WebSocketServer | null = null;
	#host: string;
	#connections = 0;

	constructor(deps: DataPlaneDeps) {
		this.#deps = deps;
		this.#host = "127.0.0.1";
	}

	get host(): string {
		return this.#host;
	}

	get listening(): boolean {
		return this.#server?.listening ?? false;
	}

	get connectionCount(): number {
		return this.#connections;
	}

	/** Port the listener is bound to (`null` before `listen`). */
	get boundPort(): number | null {
		const address = this.#server?.address();
		return typeof address === "object" && address !== null ? address.port : null;
	}

	get serverKeyPair(): DataPlaneDeps["serverKeyPair"] {
		return this.#deps.serverKeyPair;
	}

	get logger(): DataPlaneLogger {
		return this.#deps.logger;
	}

	get audit(): AuditLogger {
		return this.#deps.audit;
	}

	get upstream(): UpstreamHub {
		return this.#deps.upstream;
	}

	#now(): number {
		return this.#deps.now?.() ?? Date.now();
	}

	resolveToken(deviceToken: string): ReturnType<typeof resolveDeviceToken> {
		return resolveDeviceToken(deviceToken, {
			registry: this.#deps.registry,
			offers: this.#deps.offers,
			audit: this.#deps.audit,
			now: this.#now.bind(this),
		});
	}

	#serveStatic(request: IncomingMessage, response: ServerResponse): void {
		const url = new URL(request.url ?? "/", "http://localhost");
		const pathname = url.pathname;
		const headers = { "cache-control": "no-store", ...MOBILE_SHELL_SECURITY_HEADERS };
		if (request.method !== "GET" && request.method !== "HEAD") {
			response.writeHead(405, headers);
			response.end();
			return;
		}
		let relative = "";
		if (pathname === "/m") {
			response.writeHead(302, { ...headers, location: "/m/" });
			response.end();
			return;
		}
		if (pathname === "/m/") relative = "index.html";
		else if (pathname.startsWith("/m/")) relative = pathname.slice("/m/".length);
		else {
			response.writeHead(404, headers);
			response.end("not found");
			return;
		}
		const filePath = resolveMobileStaticPath(this.#deps.mobileDir, relative);
		if (filePath === null) {
			response.writeHead(403, headers);
			response.end("forbidden");
			return;
		}
		if (!existsSync(filePath)) {
			response.writeHead(404, headers);
			response.end("not found");
			return;
		}
		const body = readFileSync(filePath);
		const ext = filePath.slice(filePath.lastIndexOf("."));
		response.writeHead(200, {
			...headers,
			"cache-control": cacheControlForMobile(relative),
			"content-type": MIME[ext] ?? "application/octet-stream",
		});
		response.end(request.method === "HEAD" ? undefined : body);
	}

	#claimHits = new Map<string, number[]>();

	#requestHandler = (request: IncomingMessage, response: ServerResponse): void => {
		try {
			const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
			if (pathname === "/m/claim") {
				void this.#serveClaim(request, response);
				return;
			}
			this.#serveStatic(request, response);
		} catch (error) {
			this.#deps.logger.error(`data plane request failed (${error instanceof Error ? error.name : "error"})`);
			response.writeHead(500);
			response.end();
		}
	};

	#serveClaim = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
		const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
		if (request.method !== "POST") {
			response.writeHead(405, { ...headers, allow: "POST" });
			response.end();
			return;
		}
		const body = await readJsonBody(request, response);
		if (body === undefined) return;
		const record = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
		const raw = typeof record?.code === "string" ? record.code : "";
		const code = normalizePairCode(raw);
		if (!isCompletePairCode(code)) {
			writeJson(response, 400, { ok: false, error: { code: "invalid_params", message: "invalid pairing code format" } });
			return;
		}
		const ip = request.socket.remoteAddress ?? "unknown";
		if (this.#claimBlocked(ip)) {
			writeJson(response, 429, { ok: false, error: { code: "rate_limited", message: "too many attempts" } });
			return;
		}
		const offer = this.#deps.offers.findByPairCode(code, this.#now());
		if (offer === null) {
			this.#claimFail(ip);
			this.#deps.audit.log({ event: "pair_code_miss" }, this.#now());
			writeJson(response, 404, { ok: false, error: { code: "not-found", message: "pairing code invalid or expired" } });
			return;
		}
		this.#deps.audit.log({ event: "pair_code_hit", detail: { offerId: offer.offerId } }, this.#now());
		writeJson(response, 200, { ok: true, offer });
	};

	#claimBlocked(ip: string): boolean {
		const now = this.#now();
		const hits = (this.#claimHits.get(ip) ?? []).filter((time) => now - time < 60_000);
		this.#claimHits.set(ip, hits);
		return hits.length >= 8;
	}

	#claimFail(ip: string): void {
		const hits = this.#claimHits.get(ip) ?? [];
		hits.push(this.#now());
		this.#claimHits.set(ip, hits);
	}

	admit(): boolean {
		if (this.#connections >= MAX_CONNECTIONS) return false;
		this.#connections += 1;
		this.#deps.audit.log({ event: "connection_open" }, this.#now());
		return true;
	}

	release(): void {
		this.#connections = Math.max(0, this.#connections - 1);
		this.#deps.audit.log({ event: "connection_close" }, this.#now());
	}

	connectionDeps(): ConnectionDeps {
		return {
			serverKeyPair: this.serverKeyPair,
			resolveToken: (token) => this.resolveToken(token),
			audit: this.audit,
			logger: this.logger,
			upstream: this.upstream,
			renameDevice: (deviceId, displayName) => this.#deps.registry.rename(deviceId, displayName) !== null,
			admit: () => this.admit(),
			release: () => this.release(),
			now: () => this.#now(),
		};
	}

	#onConnection = (ws: WebSocket): void => {
		if (this.#connections >= MAX_CONNECTIONS) {
			ws.close(CLOSE_OVERLOAD, "connection limit");
			return;
		}
		acceptMobileSocket(ws, this.connectionDeps()).start();
	};

	/** Listen on `host` (closing any existing listener first). */
	async listen(host: string): Promise<void> {
		if (this.#server !== null && this.#host === host) return;
		await this.#closeListener();
		this.#host = host;
		const server = createServer(this.#requestHandler);
		const wss = new WebSocketServer({ server, path: "/m/ws", maxPayload: MAX_WS_PAYLOAD });
		wss.on("connection", this.#onConnection);
		this.#server = server;
		this.#wss = wss;
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(this.#deps.port, host, () => {
				server.removeListener("error", reject);
				resolve();
			});
		});
	}

	#closeListener(): Promise<void> {
		return new Promise((resolve) => {
			const wss = this.#wss;
			const server = this.#server;
			this.#wss = null;
			this.#server = null;
			if (wss !== null) {
				for (const client of wss.clients) client.terminate();
				wss.close();
			}
			if (server === null) {
				resolve();
				return;
			}
			server.close(() => resolve());
			setTimeout(() => {
				server.closeAllConnections?.();
				resolve();
			}, 1_000).unref?.();
		});
	}

	async close(): Promise<void> {
		await this.#closeListener();
	}
}
