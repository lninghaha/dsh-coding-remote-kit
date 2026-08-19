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
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { FrameQueue } from "./backpressure.js";
import {
	CLOSE_AUTH_FAILED,
	CLOSE_DECRYPT_FAILURES,
	CLOSE_HANDSHAKE_TIMEOUT,
	CLOSE_OVERLOAD,
	DIRECTION_MOBILE_TO_SERVER,
	DIRECTION_SERVER_TO_MOBILE,
	HEARTBEAT_INTERVAL_MS,
	HANDSHAKE_TIMEOUT_MS,
	MAX_CONNECTIONS,
	MAX_DECRYPT_FAILURES,
	MAX_WS_PAYLOAD,
	PAYLOAD_KIND_TEXT,
} from "../shared/constants.js";
import { base64Decode, base64Encode, utf8Decode, utf8Encode } from "../shared/base64.js";
import { buildE2eeError } from "../shared/handshake.js";
import { open, seal } from "../shared/frame.js";
import { dispatchRpc } from "./rpc.js";
import { resolveDeviceToken, ServerHandshake, type ServerSessionKeys } from "./e2ee.js";
import type { AuditLogger, DeviceRegistry, OfferRegistry } from "./registry.js";
import type { Subscriber, UpstreamHub } from "./upstream.js";

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
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".txt": "text/plain; charset=utf-8",
};

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
		const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
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
		response.writeHead(200, { ...headers, "content-type": MIME[ext] ?? "application/octet-stream" });
		response.end(request.method === "HEAD" ? undefined : body);
	}

	#requestHandler = (request: IncomingMessage, response: ServerResponse): void => {
		try {
			this.#serveStatic(request, response);
		} catch (error) {
			this.#deps.logger.error(`data plane request failed (${error instanceof Error ? error.name : "error"})`);
			response.writeHead(500);
			response.end();
		}
	};

	#onConnection = (ws: WebSocket): void => {
		if (this.#connections >= MAX_CONNECTIONS) {
			ws.close(CLOSE_OVERLOAD, "connection limit");
			return;
		}
		this.#connections += 1;
		this.#deps.audit.log({ event: "connection_open" }, this.#now());
		ws.on("close", () => {
			this.#connections -= 1;
			this.#deps.audit.log({ event: "connection_close" }, this.#now());
		});
		const connection = new MobileConnection(ws, this);
		connection.start();
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

type ConnectionState = "awaiting-hello" | "awaiting-auth" | "authenticated";

class MobileConnection {
	readonly #ws: WebSocket;
	readonly #plane: MobileDataPlane;
	readonly #handshake: ServerHandshake;
	readonly #queue: FrameQueue;

	#state: ConnectionState = "awaiting-hello";
	#keys: ServerSessionKeys | null = null;
	#sendCounter: Record<number, number> = { 0: 0, 1: 0 };
	#recvCounter: Record<number, number> = { 0: 0, 1: 0 };
	#consecutiveFailures = 0;
	#alive = true;
	#heartbeat: ReturnType<typeof setInterval> | null = null;
	#authTimeout: ReturnType<typeof setTimeout> | null = null;
	#disposed = false;
	#deviceId: string | null = null;
	#subscriber: Subscriber | null = null;

	constructor(ws: WebSocket, plane: MobileDataPlane) {
		this.#ws = ws;
		this.#plane = plane;
		this.#handshake = new ServerHandshake(plane.serverKeyPair, (token) => plane.resolveToken(token));
		this.#queue = new FrameQueue(
			{
				get bufferedAmount() {
					return ws.bufferedAmount;
				},
				send: (data, isBinary) => {
					if (ws.readyState !== WebSocket.OPEN) return;
					if (isBinary === true) {
						ws.send(data, { binary: true });
						return;
					}
					ws.send(base64Encode(data));
				},
				close: (code, reason) => ws.close(code, reason),
			},
			(payload) => this.#sealOut(payload),
		);
	}

	start(): void {
		this.#ws.on("message", (data, isBinary) => this.#onMessage(data, isBinary));
		this.#ws.on("pong", () => {
			this.#alive = true;
		});
		this.#ws.on("close", () => this.#dispose());
		this.#ws.on("error", () => this.#dispose());
		this.#heartbeat = setInterval(() => {
			if (!this.#alive) {
				this.#ws.terminate();
				return;
			}
			this.#alive = false;
			try {
				this.#ws.ping();
			} catch {
				this.#ws.terminate();
			}
		}, HEARTBEAT_INTERVAL_MS);
		this.#authTimeout = setTimeout(() => {
			this.#ws.close(CLOSE_HANDSHAKE_TIMEOUT, "handshake timeout");
		}, HANDSHAKE_TIMEOUT_MS);
		this.#queue.start();
	}

	#dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		if (this.#subscriber !== null) {
			this.#plane.upstream.removeSubscriber(this.#subscriber);
			this.#subscriber = null;
		}
		if (this.#heartbeat !== null) {
			clearInterval(this.#heartbeat);
			this.#heartbeat = null;
		}
		if (this.#authTimeout !== null) {
			clearTimeout(this.#authTimeout);
			this.#authTimeout = null;
		}
		this.#queue.stop();
	}

	subscribeSession(sessionId: string): void {
		if (this.#subscriber === null) return;
		this.#plane.upstream.subscribeSession(this.#subscriber, sessionId);
	}

	unsubscribeSession(sessionId: string): void {
		if (this.#subscriber === null) return;
		this.#plane.upstream.unsubscribeSession(this.#subscriber, sessionId);
	}

	subscribeHost(): void {
		if (this.#subscriber === null) return;
		this.#plane.upstream.subscribeHost(this.#subscriber);
	}

	/** Seal one outbound text frame; the counter advances only at send time. */
	#sealOut(payload: Uint8Array): Uint8Array {
		if (this.#keys === null) throw new Error("session keys are not ready");
		const counter = this.#sendCounter[PAYLOAD_KIND_TEXT] ?? 0;
		this.#sendCounter[PAYLOAD_KIND_TEXT] = counter + 1;
		return seal(this.#keys.serverToMobileKey, this.#keys.sessionId, DIRECTION_SERVER_TO_MOBILE, PAYLOAD_KIND_TEXT, counter, payload);
	}

	/** Queue an encrypted outbound JSON message. */
	#sendEncrypted(value: unknown): void {
		const outcome = this.#queue.enqueue(utf8Encode(JSON.stringify(value)));
		if (outcome === "overflow") this.#dispose();
	}

	/** Send a plaintext JSON message (handshake only). */
	#sendPlain(value: unknown): void {
		if (this.#ws.readyState !== WebSocket.OPEN) return;
		this.#ws.send(JSON.stringify(value));
	}

	/** Open one inbound sealed frame, tracking the receive counter + failures. */
	#openIn(sealedBytes: Uint8Array): Uint8Array | null {
		if (this.#keys === null) return null;
		const counter = this.#recvCounter[PAYLOAD_KIND_TEXT] ?? 0;
		const payload = open(
			sealedBytes,
			this.#keys.mobileToServerKey,
			this.#keys.sessionId,
			DIRECTION_MOBILE_TO_SERVER,
			PAYLOAD_KIND_TEXT,
			counter,
		);
		if (payload === null) {
			this.#consecutiveFailures += 1;
			if (this.#consecutiveFailures >= MAX_DECRYPT_FAILURES) {
				this.#ws.close(CLOSE_DECRYPT_FAILURES, "too many decryption failures");
			}
			return null;
		}
		this.#consecutiveFailures = 0;
		this.#recvCounter[PAYLOAD_KIND_TEXT] = counter + 1;
		return payload;
	}

	#onMessage(data: RawData, isBinary: boolean): void {
		if (isBinary && this.#state !== "authenticated") {
			this.#ws.close(CLOSE_AUTH_FAILED, "binary frame before authentication");
			return;
		}
		if (isBinary) {
			// Binary payloads are reserved for M3+; M2 uses text only.
			this.#ws.close(CLOSE_AUTH_FAILED, "binary payload unsupported");
			return;
		}
		const text = data.toString();
		if (this.#state === "awaiting-hello") {
			let message: unknown;
			try {
				message = JSON.parse(text);
			} catch {
				this.#ws.close(CLOSE_AUTH_FAILED, "invalid JSON");
				return;
			}
			this.#handleHello(message);
			return;
		}
		// Encrypted frames: base64(sealed) in a text frame.
		let sealedBytes: Uint8Array;
		try {
			sealedBytes = base64Decode(text);
		} catch {
			this.#rejectEncrypted("bad base64");
			return;
		}
		const payload = this.#openIn(sealedBytes);
		if (payload === null) {
			if (this.#state === "awaiting-auth") {
				this.#sendEncrypted(buildE2eeError("bad_auth"));
				this.#ws.close(CLOSE_AUTH_FAILED, "bad auth");
			}
			return;
		}
		let message: unknown;
		try {
			message = JSON.parse(utf8Decode(payload));
		} catch {
			this.#rejectEncrypted("invalid payload JSON");
			return;
		}
		if (this.#state === "awaiting-auth") this.#handleAuth(message);
		else this.#handleRpc(message);
	}

	#rejectEncrypted(_reason: string): void {
		if (this.#state === "awaiting-auth") {
			this.#sendEncrypted(buildE2eeError("bad_auth"));
		}
		this.#ws.close(CLOSE_AUTH_FAILED, "bad auth");
	}

	#handleHello(message: unknown): void {
		const result = this.#handshake.start(message);
		if (!result.ok) {
			this.#sendPlain(buildE2eeError("bad_auth"));
			this.#ws.close(CLOSE_AUTH_FAILED, "bad auth");
			return;
		}
		this.#keys = this.#handshake.deriveKeys();
		this.#state = "awaiting-auth";
		this.#sendPlain(result.ready);
	}

	#handleAuth(message: unknown): void {
		const result = this.#handshake.finish(message);
		if (!result.ok) {
			this.#sendEncrypted(buildE2eeError(result.code === "unauthorized" ? "unauthorized" : "bad_auth"));
			this.#ws.close(CLOSE_AUTH_FAILED, result.code ?? "bad auth");
			return;
		}
		this.#keys = result.keys ?? this.#keys;
		this.#state = "authenticated";
		this.#deviceId = result.deviceId ?? null;
		this.#subscriber = {
			sessionIds: new Set<string>(),
			host: false,
			send: (push) => this.#sendEncrypted(push),
		};
		this.#plane.upstream.addSubscriber(this.#subscriber);
		if (this.#authTimeout !== null) {
			clearTimeout(this.#authTimeout);
			this.#authTimeout = null;
		}
		this.#sendEncrypted(result.authenticated);
	}

	#handleRpc(message: unknown): void {
		void this.#dispatchRpc(message);
	}

	async #dispatchRpc(message: unknown): Promise<void> {
		const reply = await dispatchRpc(message, {
			upstream: this.#plane.upstream,
			...(this.#deviceId === null ? {} : { deviceId: this.#deviceId }),
			audit: this.#plane.audit,
			connection: this,
		});
		if (this.#disposed) return;
		this.#sendEncrypted(reply);
	}
}
