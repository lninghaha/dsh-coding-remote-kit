import { DurableObject } from "cloudflare:workers";
import {
	RELAY_MAX_FRAME_BYTES,
	RELAY_MAX_UNAUTH_PHONES,
	RELAY_TICKET_BYTES,
	RELAY_TICKET_TTL_MS,
	RELAY_VERSION,
	isPing,
	parseClaimResult,
	parseHostHello,
	parseInvitePut,
	parseJsonObject,
} from "../../src/shared/relay.ts";
import { ProtocolValidationError } from "../../src/shared/validation.ts";
import { randomToken, tokenEquals } from "./crypto.ts";

export interface RelayEnv {
	RENDEZVOUS: DurableObjectNamespace;
	HOST_TOKEN: string;
	ASSETS?: Fetcher;
}

type Role = "host" | "phone" | "accept";

interface SocketAttachment {
	readonly role: Role;
	readonly ticket?: string;
}

interface InviteRecord {
	readonly invite: string;
	readonly expiresAt: number;
	readonly offerId: string;
}

interface TicketRecord {
	readonly expiresAt: number;
}

const INVITES_KEY = "invites";
const TICKETS_KEY = "tickets";
const HOST_ID_KEY = "hostId";
const CLAIM_HITS_KEY = "claimHits";

export class RendezvousRoom extends DurableObject<RelayEnv> {
	readonly #buffers = new Map<string, Array<string | ArrayBuffer>>();

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (request.headers.get("Upgrade") === "websocket") {
			return this.#acceptSocket(request, url);
		}
		if (url.pathname === "/internal/claim" && request.method === "POST") {
			return this.#claim(request);
		}
		return json({ ok: false, error: { code: "not-found", message: "not found" } }, 404);
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		const attachment = (ws.deserializeAttachment() ?? null) as SocketAttachment | null;
		if (attachment === null) {
			ws.close(4001, "no attachment");
			return;
		}
		if (attachment.role === "host") {
			if (typeof message !== "string") return;
			await this.#onHostText(ws, message);
			return;
		}
		if (typeof message === "string" && message.length > RELAY_MAX_FRAME_BYTES) {
			ws.close(1009, "frame too large");
			return;
		}
		if (typeof message !== "string" && message.byteLength > RELAY_MAX_FRAME_BYTES) {
			ws.close(1009, "frame too large");
			return;
		}
		const want: Role = attachment.role === "phone" ? "accept" : "phone";
		const peer = this.#find(want, attachment.ticket);
		if (peer === null) {
			this.#buffer(attachment.ticket, message);
			return;
		}
		peer.send(message);
	}

	async webSocketClose(ws: WebSocket): Promise<void> {
		const attachment = (ws.deserializeAttachment() ?? null) as SocketAttachment | null;
		if (attachment?.role === "host") {
			await this.ctx.storage.delete(HOST_ID_KEY);
		}
		if (attachment?.ticket !== undefined) {
			this.#buffers.delete(attachment.ticket);
			const peerRole: Role = attachment.role === "phone" ? "accept" : "phone";
			const peer = this.#find(peerRole, attachment.ticket);
			try {
				peer?.close(1001, "peer closed");
			} catch {
				// already gone
			}
		}
	}

	async #acceptSocket(request: Request, url: URL): Promise<Response> {
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);
		if (url.pathname === "/v1/host") {
			this.ctx.acceptWebSocket(server);
			server.serializeAttachment({ role: "host" } satisfies SocketAttachment);
			return new Response(null, { status: 101, webSocket: client });
		}
		const phoneMatch = /^\/v1\/phone\/([^/]+)$/u.exec(url.pathname);
		if (phoneMatch !== null) {
			return this.#acceptPhone(url, phoneMatch[1] ?? "", client, server);
		}
		const acceptMatch = /^\/v1\/accept\/([^/]+)$/u.exec(url.pathname);
		if (acceptMatch !== null) {
			return this.#acceptAccept(acceptMatch[1] ?? "", client, server);
		}
		return json({ ok: false, error: { code: "not-found", message: "unknown socket" } }, 404);
	}

	async #acceptPhone(url: URL, hostId: string, client: WebSocket, server: WebSocket): Promise<Response> {
		const connectedHostId = await this.ctx.storage.get<string>(HOST_ID_KEY);
		if (connectedHostId === undefined) {
			return json({ ok: false, error: { code: "unavailable", message: "desktop is not connected" } }, 503);
		}
		if (hostId !== connectedHostId) {
			return json({ ok: false, error: { code: "unauthorized", message: "hostId mismatch" } }, 403);
		}
		const pending = this.#pendingPhones();
		if (pending >= RELAY_MAX_UNAUTH_PHONES) {
			return json({ ok: false, error: { code: "overload", message: "too many phones" } }, 503);
		}
		const resume = url.searchParams.get("resume") === "1";
		const invite = url.searchParams.get("invite");
		if (!resume) {
			if (invite === null || invite.length === 0) {
				return json({ ok: false, error: { code: "unauthorized", message: "invite required" } }, 403);
			}
			const invites = (await this.ctx.storage.get<Record<string, InviteRecord>>(INVITES_KEY)) ?? {};
			const record = invites[invite];
			const now = Date.now();
			if (record === undefined || record.expiresAt <= now) {
				return json({ ok: false, error: { code: "unauthorized", message: "invite invalid" } }, 403);
			}
		}
		const ticket = randomToken(RELAY_TICKET_BYTES);
		const expiresAt = Date.now() + RELAY_TICKET_TTL_MS;
		const tickets = (await this.ctx.storage.get<Record<string, TicketRecord>>(TICKETS_KEY)) ?? {};
		tickets[ticket] = { expiresAt };
		await this.ctx.storage.put(TICKETS_KEY, tickets);
		const host = this.#find("host");
		if (host === null) {
			return json({ ok: false, error: { code: "unavailable", message: "desktop is not connected" } }, 503);
		}
		this.ctx.acceptWebSocket(server);
		server.serializeAttachment({ role: "phone", ticket } satisfies SocketAttachment);
		host.send(JSON.stringify({ type: "phone_waiting", ticket, expiresAt }));
		return new Response(null, { status: 101, webSocket: client });
	}

	async #acceptAccept(ticket: string, client: WebSocket, server: WebSocket): Promise<Response> {
		const tickets = (await this.ctx.storage.get<Record<string, TicketRecord>>(TICKETS_KEY)) ?? {};
		const record = tickets[ticket];
		if (record === undefined || record.expiresAt <= Date.now()) {
			return json({ ok: false, error: { code: "unauthorized", message: "ticket invalid" } }, 403);
		}
		delete tickets[ticket];
		await this.ctx.storage.put(TICKETS_KEY, tickets);
		this.ctx.acceptWebSocket(server);
		server.serializeAttachment({ role: "accept", ticket } satisfies SocketAttachment);
		const buffered = this.#buffers.get(ticket) ?? [];
		this.#buffers.delete(ticket);
		for (const frame of buffered) server.send(frame);
		return new Response(null, { status: 101, webSocket: client });
	}

	async #onHostText(ws: WebSocket, text: string): Promise<void> {
		let message: Record<string, unknown>;
		try {
			message = parseJsonObject(text);
		} catch {
			ws.send(JSON.stringify({ type: "host_error", error: { code: "invalid" } }));
			return;
		}
		if (isPing(message)) {
			ws.send(JSON.stringify({ type: "pong" }));
			return;
		}
		if (message.type === "host_hello") {
			await this.#onHello(ws, message);
			return;
		}
		if (message.type === "invite_put") {
			await this.#onInvite(ws, message);
			return;
		}
		if (message.type === "claim_result") {
			this.#onClaimResult?.(message);
		}
	}

	async #onHello(ws: WebSocket, raw: unknown): Promise<void> {
		let hello;
		try {
			hello = parseHostHello(raw);
		} catch {
			ws.send(JSON.stringify({ type: "host_error", error: { code: "invalid" } }));
			ws.close(4001, "invalid hello");
			return;
		}
		const expected = this.env.HOST_TOKEN ?? "";
		if (expected.length === 0 || !(await tokenEquals(hello.hostToken, expected))) {
			ws.send(JSON.stringify({ type: "host_error", error: { code: "unauthorized" } }));
			ws.close(4001, "unauthorized");
			return;
		}
		for (const other of this.ctx.getWebSockets()) {
			if (other === ws) continue;
			const attachment = (other.deserializeAttachment() ?? null) as SocketAttachment | null;
			if (attachment?.role === "host") {
				try {
					other.close(4000, "replaced");
				} catch {
					// already gone
				}
			}
		}
		await this.ctx.storage.put(HOST_ID_KEY, hello.hostId);
		ws.send(JSON.stringify({ type: "host_ok", v: RELAY_VERSION, hostId: hello.hostId }));
	}

	async #onInvite(ws: WebSocket, raw: unknown): Promise<void> {
		let put;
		try {
			put = parseInvitePut(raw);
		} catch (error) {
			ws.send(
				JSON.stringify({
					type: "host_error",
					error: { code: "invalid" },
				}),
			);
			return;
		}
		const invites = (await this.ctx.storage.get<Record<string, InviteRecord>>(INVITES_KEY)) ?? {};
		const now = Date.now();
		for (const [key, record] of Object.entries(invites)) {
			if (record.expiresAt <= now) delete invites[key];
		}
		invites[put.invite] = { invite: put.invite, expiresAt: put.expiresAt, offerId: put.offerId };
		await this.ctx.storage.put(INVITES_KEY, invites);
		ws.send(JSON.stringify({ type: "invite_ack", offerId: put.offerId }));
	}

	async #claim(request: Request): Promise<Response> {
		const ip = request.headers.get("x-claim-ip") ?? "unknown";
		if (await this.#claimBlocked(ip)) {
			return json({ ok: false, error: { code: "rate_limited", message: "尝试次数过多，请稍后再试" } }, 429);
		}
		const host = this.#find("host");
		if (host === null) {
			return json({ ok: false, error: { code: "unavailable", message: "desktop is not connected" } }, 503);
		}
		let body: unknown;
		try {
			body = await request.json();
		} catch {
			return json({ ok: false, error: { code: "invalid_params", message: "配对码格式不对" } }, 400);
		}
		const record = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
		const code = typeof record?.code === "string" ? record.code : "";
		if (code.length === 0) {
			return json({ ok: false, error: { code: "invalid_params", message: "配对码格式不对" } }, 400);
		}
		const requestId = randomToken(16);
		const result = await new Promise<unknown>((resolve) => {
			const timer = setTimeout(() => resolve(null), 5_000);
			const original = this.#onClaimResult;
			this.#onClaimResult = (message) => {
				try {
					const parsed = parseClaimResult(message);
					if (parsed.requestId !== requestId) return;
					clearTimeout(timer);
					this.#onClaimResult = original;
					resolve(parsed);
				} catch {
					// ignore
				}
			};
			host.send(JSON.stringify({ type: "claim", requestId, code }));
		});
		if (result === null) {
			await this.#claimFail(ip);
			return json({ ok: false, error: { code: "unavailable", message: "desktop did not answer" } }, 503);
		}
		const parsed = result as ReturnType<typeof parseClaimResult>;
		if (parsed.error !== undefined) {
			await this.#claimFail(ip);
			return json({ ok: false, error: parsed.error }, 404);
		}
		return json({ ok: true, offer: parsed.offer });
	}

	#onClaimResult: ((message: unknown) => void) | null = null;

	#find(role: Role, ticket?: string): WebSocket | null {
		for (const ws of this.ctx.getWebSockets()) {
			const attachment = (ws.deserializeAttachment() ?? null) as SocketAttachment | null;
			if (attachment?.role !== role) continue;
			if (ticket !== undefined && attachment.ticket !== ticket) continue;
			return ws;
		}
		return null;
	}

	#pendingPhones(): number {
		let count = 0;
		for (const ws of this.ctx.getWebSockets()) {
			const attachment = (ws.deserializeAttachment() ?? null) as SocketAttachment | null;
			if (attachment?.role === "phone") count += 1;
		}
		return count;
	}

	#buffer(ticket: string | undefined, message: string | ArrayBuffer): void {
		if (ticket === undefined) return;
		const list = this.#buffers.get(ticket) ?? [];
		if (list.length >= 16) return;
		list.push(message);
		this.#buffers.set(ticket, list);
	}

	async #claimBlocked(ip: string): Promise<boolean> {
		const now = Date.now();
		const hits = (await this.ctx.storage.get<Record<string, number[]>>(CLAIM_HITS_KEY)) ?? {};
		const recent = (hits[ip] ?? []).filter((time) => now - time < 60_000);
		hits[ip] = recent;
		await this.ctx.storage.put(CLAIM_HITS_KEY, hits);
		return recent.length >= 8;
	}

	async #claimFail(ip: string): Promise<void> {
		const now = Date.now();
		const hits = (await this.ctx.storage.get<Record<string, number[]>>(CLAIM_HITS_KEY)) ?? {};
		const recent = (hits[ip] ?? []).filter((time) => now - time < 60_000);
		recent.push(now);
		hits[ip] = recent;
		await this.ctx.storage.put(CLAIM_HITS_KEY, hits);
	}
}

export function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
			"x-content-type-options": "nosniff",
		},
	});
}

void ProtocolValidationError;
