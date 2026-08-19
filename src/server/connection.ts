/**
 * Authenticated mobile session on a single WebSocket.
 *
 * Used by the LAN data plane (`/m/ws`) and by rendezvous accept sockets so
 * both transports share the same E2EE + RPC state machine.
 */

import { WebSocket, type RawData } from "ws";
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
	MAX_DECRYPT_FAILURES,
	PAYLOAD_KIND_TEXT,
} from "../shared/constants.js";
import { base64Decode, base64Encode, utf8Decode, utf8Encode } from "../shared/base64.js";
import { buildE2eeError } from "../shared/handshake.js";
import { open, seal } from "../shared/frame.js";
import { dispatchRpc } from "./rpc.js";
import { ServerHandshake, type ResolveToken, type ServerSessionKeys } from "./e2ee.js";
import type { AuditLogger } from "./registry.js";
import type { Subscriber, UpstreamHub } from "./upstream.js";

export interface ConnectionLogger {
	debug(message: string): void;
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

export interface ConnectionDeps {
	readonly serverKeyPair: { readonly secretKey: Uint8Array; readonly publicKey: Uint8Array };
	readonly resolveToken: ResolveToken;
	readonly audit: AuditLogger;
	readonly logger: ConnectionLogger;
	readonly upstream: UpstreamHub;
	/** Return false when the connection cap is exceeded. */
	admit(): boolean;
	release(): void;
	readonly now?: () => number;
}

export interface MobileConnectionHandle {
	start(): void;
}

type ConnectionState = "awaiting-hello" | "awaiting-auth" | "authenticated";

class MobileConnection implements MobileConnectionHandle {
	readonly #ws: WebSocket;
	readonly #deps: ConnectionDeps;
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
	#admitted = false;

	constructor(ws: WebSocket, deps: ConnectionDeps) {
		this.#ws = ws;
		this.#deps = deps;
		this.#handshake = new ServerHandshake(deps.serverKeyPair, (token) => deps.resolveToken(token));
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
		if (!this.#deps.admit()) {
			this.#ws.close(CLOSE_OVERLOAD, "connection limit");
			return;
		}
		this.#admitted = true;
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
			this.#deps.upstream.removeSubscriber(this.#subscriber);
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
		if (this.#admitted) this.#deps.release();
	}

	subscribeSession(sessionId: string): void {
		if (this.#subscriber === null) return;
		this.#deps.upstream.subscribeSession(this.#subscriber, sessionId);
	}

	unsubscribeSession(sessionId: string): void {
		if (this.#subscriber === null) return;
		this.#deps.upstream.unsubscribeSession(this.#subscriber, sessionId);
	}

	subscribeHost(): void {
		if (this.#subscriber === null) return;
		this.#deps.upstream.subscribeHost(this.#subscriber);
	}

	#sealOut(payload: Uint8Array): Uint8Array {
		if (this.#keys === null) throw new Error("session keys are not ready");
		const counter = this.#sendCounter[PAYLOAD_KIND_TEXT] ?? 0;
		this.#sendCounter[PAYLOAD_KIND_TEXT] = counter + 1;
		return seal(this.#keys.serverToMobileKey, this.#keys.sessionId, DIRECTION_SERVER_TO_MOBILE, PAYLOAD_KIND_TEXT, counter, payload);
	}

	#sendEncrypted(value: unknown): void {
		const outcome = this.#queue.enqueue(utf8Encode(JSON.stringify(value)));
		if (outcome === "overflow") this.#dispose();
	}

	#sendPlain(value: unknown): void {
		if (this.#ws.readyState !== WebSocket.OPEN) return;
		this.#ws.send(JSON.stringify(value));
	}

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
		this.#deps.upstream.addSubscriber(this.#subscriber);
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
			upstream: this.#deps.upstream,
			...(this.#deviceId === null ? {} : { deviceId: this.#deviceId }),
			audit: this.#deps.audit,
			connection: this,
		});
		if (this.#disposed) return;
		this.#sendEncrypted(reply);
	}
}

/** Admit a WebSocket as a mobile E2EE session. */
export function acceptMobileSocket(ws: WebSocket, deps: ConnectionDeps): MobileConnectionHandle {
	return new MobileConnection(ws, deps);
}
