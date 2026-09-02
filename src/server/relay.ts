/**
 * Outbound rendezvous client (`dshmr-relay/v1`).
 *
 * The desktop opens a control WebSocket to a self-hosted Worker and, for each
 * phone, a second accept socket that is handed to `acceptMobileSocket`. This
 * module never talks to `cloudflared` and never funnels port 3080.
 */

import { unlinkSync } from "node:fs";
import { WebSocket } from "ws";
import { base64UrlEncode } from "../shared/base64.js";
import {
	assertHttpsRelayOrigin,
	hostErrorCode,
	isPing,
	isPong,
	parseClaim,
	parseHostOk,
	parseInviteAck,
	parseJsonObject,
	parsePhoneWaiting,
	parseRelayOrigin,
	RELAY_HELLO_TIMEOUT_MS,
	RELAY_HOST_ID_BYTES,
	RELAY_INVITE_BYTES,
	type RelayAdvertiseResult,
	relayAcceptUrl,
	relayAdvertise,
	relayHostUrl,
	stripOrigin,
} from "../shared/relay.js";
import { ProtocolValidationError } from "../shared/validation.js";
import { acceptMobileSocket, type ConnectionDeps } from "./connection.js";
import { randomBytes } from "./crypto.js";
import type { OfferRegistry } from "./registry.js";
import { readJsonFile, writeFileAtomic } from "./storage.js";

export interface RendezvousSnapshot {
	readonly running: boolean;
	readonly kind: "rendezvous" | null;
	readonly url: string | null;
	readonly hostConnected: boolean;
	readonly binaryOk: true;
	readonly hasToken: boolean;
}

export interface RelayPersisted {
	readonly origin: string;
	readonly hostId: string;
	readonly hostToken: string;
	readonly updatedAt: number;
}

export interface RelayLogger {
	debug(message: string): void;
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

export type RelayConnect = (url: string) => WebSocket;

export interface RendezvousClientOptions {
	readonly persistFile: string;
	readonly logger: RelayLogger;
	readonly offers: OfferRegistry;
	readonly connectionDeps: () => ConnectionDeps;
	readonly connect?: RelayConnect;
	readonly now?: () => number;
}

function defaultConnect(url: string): WebSocket {
	return new WebSocket(url);
}

export class RendezvousClient {
	readonly #persistFile: string;
	readonly #logger: RelayLogger;
	readonly #offers: OfferRegistry;
	readonly #connectionDeps: () => ConnectionDeps;
	readonly #connect: RelayConnect;
	readonly #now: () => number;

	#running = false;
	#hostConnected = false;
	#origin: string | null = null;
	#hostId: string | null = null;
	#hostToken: string | null = null;
	#control: WebSocket | null = null;
	#accepts = new Set<WebSocket>();
	#helloWait: {
		resolve: (value: void) => void;
		reject: (error: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	} | null = null;
	#inviteWaits = new Map<
		string,
		{ resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
	>();
	#reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(options: RendezvousClientOptions) {
		this.#persistFile = options.persistFile;
		this.#logger = options.logger;
		this.#offers = options.offers;
		this.#connectionDeps = options.connectionDeps;
		this.#connect = options.connect ?? defaultConnect;
		this.#now = options.now ?? (() => Date.now());
		this.#loadPersisted();
	}

	snapshot(): RendezvousSnapshot {
		return {
			running: this.#running,
			kind: this.#running ? "rendezvous" : null,
			url: this.#running ? this.#origin : null,
			hostConnected: this.#hostConnected,
			binaryOk: true,
			hasToken: this.#hostToken !== null && this.#hostToken.length > 0,
		};
	}

	hostId(): string | null {
		return this.#hostId;
	}

	createInvite(): string {
		return base64UrlEncode(randomBytes(RELAY_INVITE_BYTES));
	}

	advertise(invite: string): RelayAdvertiseResult {
		if (this.#origin === null || this.#hostId === null) {
			throw new Error("rendezvous is not configured");
		}
		return relayAdvertise(this.#origin, this.#hostId, invite);
	}

	async putInvite(input: { invite: string; expiresAt: number; offerId: string }): Promise<void> {
		if (this.#control === null || this.#control.readyState !== WebSocket.OPEN) {
			throw new Error("rendezvous host is not connected");
		}
		const wait = new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#inviteWaits.delete(input.offerId);
				reject(new Error("timed out waiting for invite_ack"));
			}, 5_000);
			this.#inviteWaits.set(input.offerId, { resolve, reject, timer });
		});
		this.#sendControl({ type: "invite_put", invite: input.invite, expiresAt: input.expiresAt, offerId: input.offerId });
		await wait;
	}

	async start(options: { origin?: string; hostToken?: string } = {}): Promise<string> {
		const originRaw = options.origin ?? this.#origin;
		if (originRaw === null || originRaw.length === 0) {
			throw new Error("origin is required");
		}
		const origin = stripOrigin(parseRelayOrigin(originRaw).origin);
		const token = (options.hostToken ?? this.#hostToken ?? "").trim();
		if (token.length === 0) {
			throw new Error("hostToken is required");
		}
		if (this.#running && this.#hostConnected && this.#origin === origin) return origin;
		if (this.#running) await this.stop();
		if (this.#hostId === null) this.#hostId = base64UrlEncode(randomBytes(RELAY_HOST_ID_BYTES));
		this.#origin = origin;
		this.#hostToken = token;
		this.#persist();
		this.#running = true;
		try {
			await this.#openControl();
		} catch (error) {
			this.#running = false;
			this.#closeControl();
			throw error;
		}
		return origin;
	}

	async stop(): Promise<void> {
		this.#running = false;
		this.#clearReconnect();
		this.#failHello(new Error("rendezvous stopped"));
		for (const wait of this.#inviteWaits.values()) {
			clearTimeout(wait.timer);
			wait.reject(new Error("rendezvous stopped"));
		}
		this.#inviteWaits.clear();
		this.#closeControl();
		this.#closeAccepts();
		this.#hostConnected = false;
	}

	#loadPersisted(): void {
		const persisted = readJsonFile<Partial<RelayPersisted>>(this.#persistFile);
		if (persisted === null) return;
		if (typeof persisted.origin === "string" && persisted.origin.length > 0) {
			try {
				this.#origin = stripOrigin(parseRelayOrigin(persisted.origin).origin);
			} catch {
				this.#origin = null;
			}
		}
		if (typeof persisted.hostId === "string" && persisted.hostId.length > 0) this.#hostId = persisted.hostId;
		if (typeof persisted.hostToken === "string" && persisted.hostToken.length > 0)
			this.#hostToken = persisted.hostToken;
	}

	#persist(): void {
		if (this.#origin === null || this.#hostId === null || this.#hostToken === null) return;
		writeFileAtomic(
			this.#persistFile,
			JSON.stringify({
				origin: this.#origin,
				hostId: this.#hostId,
				hostToken: this.#hostToken,
				updatedAt: this.#now(),
			} satisfies RelayPersisted),
		);
	}

	#openControl(): Promise<void> {
		if (this.#origin === null || this.#hostId === null || this.#hostToken === null) {
			return Promise.reject(new Error("rendezvous is not configured"));
		}
		this.#closeControl();
		const url = relayHostUrl(this.#origin);
		const ws = this.#connect(url);
		this.#control = ws;
		const hello: Promise<void> = new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#helloWait = null;
				reject(new Error("timed out waiting for host_ok"));
			}, RELAY_HELLO_TIMEOUT_MS);
			this.#helloWait = { resolve, reject, timer };
		});
		ws.on("open", () => {
			this.#sendControl({
				type: "host_hello",
				v: 1,
				hostId: this.#hostId,
				hostToken: this.#hostToken,
			});
		});
		ws.on("message", (data, isBinary) => {
			if (isBinary) return;
			this.#onControlText(data.toString());
		});
		ws.on("close", () => {
			this.#hostConnected = false;
			this.#failHello(new Error("rendezvous host disconnected"));
			if (this.#control === ws) this.#control = null;
			this.#scheduleReconnect();
		});
		ws.on("error", () => {
			this.#hostConnected = false;
		});
		return hello;
	}

	#onControlText(text: string): void {
		let message: Record<string, unknown>;
		try {
			message = parseJsonObject(text);
		} catch {
			this.#logger.warn("rendezvous control message ignored (invalid JSON)");
			return;
		}
		if (isPing(message)) {
			this.#sendControl({ type: "pong" });
			return;
		}
		if (isPong(message)) return;
		if (message.type === "host_ok") {
			try {
				parseHostOk(message);
			} catch {
				this.#failHello(new Error("invalid host_ok"));
				return;
			}
			this.#hostConnected = true;
			if (this.#helloWait !== null) {
				clearTimeout(this.#helloWait.timer);
				this.#helloWait.resolve();
				this.#helloWait = null;
			}
			this.#logger.info("rendezvous host connected");
			return;
		}
		const errorCode = hostErrorCode(message);
		if (errorCode !== null) {
			this.#failHello(new Error(`rendezvous host_error (${errorCode})`));
			this.#hostConnected = false;
			return;
		}
		if (message.type === "invite_ack") {
			try {
				const ack = parseInviteAck(message);
				const wait = this.#inviteWaits.get(ack.offerId);
				if (wait !== undefined) {
					clearTimeout(wait.timer);
					this.#inviteWaits.delete(ack.offerId);
					wait.resolve();
				}
			} catch {
				this.#logger.warn("rendezvous invite_ack ignored");
			}
			return;
		}
		if (message.type === "claim") {
			this.#handleClaim(message);
			return;
		}
		if (message.type === "phone_waiting") {
			this.#handlePhoneWaiting(message);
		}
	}

	#handleClaim(raw: unknown): void {
		let claim;
		try {
			claim = parseClaim(raw);
		} catch {
			return;
		}
		const offer = this.#offers.claimByPairCode(claim.code, this.#now());
		if (offer === null) {
			this.#sendControl({
				type: "claim_result",
				requestId: claim.requestId,
				error: { code: "not-found", message: "pairing code invalid or expired" },
			});
			return;
		}
		this.#sendControl({ type: "claim_result", requestId: claim.requestId, offer });
	}

	#handlePhoneWaiting(raw: unknown): void {
		let waiting;
		try {
			waiting = parsePhoneWaiting(raw);
		} catch {
			return;
		}
		if (this.#origin === null) return;
		const url = relayAcceptUrl(this.#origin, waiting.ticket);
		const ws = this.#connect(url);
		this.#accepts.add(ws);
		const drop = (): void => {
			this.#accepts.delete(ws);
		};
		ws.on("close", drop);
		ws.on("error", drop);
		const start = (): void => {
			acceptMobileSocket(ws, this.#connectionDeps()).start();
		};
		if (ws.readyState === WebSocket.OPEN) start();
		else ws.on("open", start);
	}

	#sendControl(value: unknown): void {
		if (this.#control === null || this.#control.readyState !== WebSocket.OPEN) return;
		this.#control.send(JSON.stringify(value));
	}

	#failHello(error: Error): void {
		if (this.#helloWait === null) return;
		clearTimeout(this.#helloWait.timer);
		this.#helloWait.reject(error);
		this.#helloWait = null;
	}

	#closeControl(): void {
		const ws = this.#control;
		this.#control = null;
		this.#hostConnected = false;
		if (ws === null) return;
		try {
			ws.close();
		} catch {
			// already gone
		}
	}

	#closeAccepts(): void {
		for (const ws of this.#accepts) {
			try {
				ws.close();
			} catch {
				// already gone
			}
		}
		this.#accepts.clear();
	}

	#clearReconnect(): void {
		if (this.#reconnectTimer === null) return;
		clearTimeout(this.#reconnectTimer);
		this.#reconnectTimer = null;
	}

	#scheduleReconnect(): void {
		if (!this.#running) return;
		this.#clearReconnect();
		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = null;
			if (!this.#running) return;
			void this.#openControl().catch((error) => {
				this.#logger.warn(`rendezvous reconnect failed (${error instanceof Error ? error.message : "error"})`);
				this.#scheduleReconnect();
			});
		}, 3_000);
	}
}

export function validateRelayStartBody(record: Record<string, unknown> | null): {
	origin?: string;
	hostToken?: string;
} {
	if (record === null) throw new ProtocolValidationError("body must be an object");
	const result: { origin?: string; hostToken?: string } = {};
	if (record.origin !== undefined) {
		if (typeof record.origin !== "string" || record.origin.length === 0) {
			throw new ProtocolValidationError("origin must be a non-empty string");
		}
		result.origin = assertHttpsRelayOrigin(record.origin);
	}
	if (record.hostToken !== undefined) {
		if (typeof record.hostToken !== "string" || record.hostToken.length === 0) {
			throw new ProtocolValidationError("hostToken must be a non-empty string");
		}
		result.hostToken = record.hostToken;
	}
	return result;
}

export function clearRelayPersist(path: string): void {
	try {
		unlinkSync(path);
	} catch {
		// already absent
	}
}
