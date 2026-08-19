/**
 * In-process rendezvous stand-in for plugin tests. Speaks dshmr-relay/v1
 * over loopback HTTP + ws so tests never touch Cloudflare.
 */

import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

export class MockRendezvous {
	constructor(options = {}) {
		this.hostToken = options.hostToken ?? "test-host-token";
		this.hostId = null;
		this.host = null;
		this.invites = new Map();
		this.tickets = new Map();
		this.phones = new Map();
		this.accepts = new Map();
		this.claims = [];
		this.server = createServer((request, response) => this.#http(request, response));
		this.wss = new WebSocketServer({ noServer: true });
		this.server.on("upgrade", (request, socket, head) => {
			this.wss.handleUpgrade(request, socket, head, (ws) => this.#socket(request, ws));
		});
	}

	async listen() {
		await new Promise((resolve) => this.server.listen(0, "127.0.0.1", resolve));
		const address = this.server.address();
		this.origin = `http://127.0.0.1:${address.port}`;
		return this.origin;
	}

	async close() {
		for (const ws of this.wss.clients) ws.terminate();
		this.wss.close();
		await new Promise((resolve) => this.server.close(resolve));
	}

	#http(request, response) {
		const url = new URL(request.url ?? "/", this.origin);
		const json = (status, body) => {
			response.writeHead(status, { "content-type": "application/json" });
			response.end(JSON.stringify(body));
		};
		if (url.pathname === "/health") {
			json(200, { ok: true, protocol: "dshmr-relay/v1" });
			return;
		}
		if (url.pathname === "/m/claim" && request.method === "POST") {
			void this.#claim(request, json);
			return;
		}
		json(404, { ok: false, error: { code: "not-found", message: "not found" } });
	}

	async #claim(request, json) {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		let body;
		try {
			body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		} catch {
			json(400, { ok: false, error: { code: "invalid_params", message: "bad json" } });
			return;
		}
		if (this.host === null || this.host.readyState !== WebSocket.OPEN) {
			json(503, { ok: false, error: { code: "unavailable", message: "desktop is not connected" } });
			return;
		}
		const requestId = `claim-${String(this.claims.length + 1)}`;
		const wait = new Promise((resolve) => {
			this.claims.push({ requestId, resolve });
			setTimeout(() => resolve(null), 2_000);
		});
		this.host.send(JSON.stringify({ type: "claim", requestId, code: String(body.code ?? "") }));
		const result = await wait;
		if (result === null) {
			json(503, { ok: false, error: { code: "unavailable", message: "desktop did not answer" } });
			return;
		}
		if (result.error) {
			json(404, { ok: false, error: result.error });
			return;
		}
		json(200, { ok: true, offer: result.offer });
	}

	#socket(request, ws) {
		const url = new URL(request.url ?? "/", this.origin);
		if (url.pathname === "/v1/host") {
			this.#hostSocket(ws);
			return;
		}
		const phone = /^\/v1\/phone\/([^/]+)$/u.exec(url.pathname);
		if (phone !== null) {
			this.#phoneSocket(url, phone[1], ws);
			return;
		}
		const accept = /^\/v1\/accept\/([^/]+)$/u.exec(url.pathname);
		if (accept !== null) {
			this.#acceptSocket(accept[1], ws);
			return;
		}
		ws.close(4404, "not found");
	}

	#hostSocket(ws) {
		ws.on("message", (data) => {
			let message;
			try {
				message = JSON.parse(String(data));
			} catch {
				return;
			}
			if (message.type === "ping") {
				ws.send(JSON.stringify({ type: "pong" }));
				return;
			}
			if (message.type === "host_hello") {
				if (message.hostToken !== this.hostToken) {
					ws.send(JSON.stringify({ type: "host_error", error: { code: "unauthorized" } }));
					ws.close(4001, "unauthorized");
					return;
				}
				this.hostId = message.hostId;
				this.host = ws;
				ws.send(JSON.stringify({ type: "host_ok", v: 1, hostId: message.hostId }));
				return;
			}
			if (message.type === "invite_put") {
				this.invites.set(message.invite, message);
				ws.send(JSON.stringify({ type: "invite_ack", offerId: message.offerId }));
				return;
			}
			if (message.type === "claim_result") {
				const pending = this.claims.find((item) => item.requestId === message.requestId);
				if (pending) pending.resolve(message);
			}
		});
		ws.on("close", () => {
			if (this.host === ws) this.host = null;
		});
	}

	#phoneSocket(url, hostId, ws) {
		if (this.host === null) {
			ws.close(4403, "no host");
			return;
		}
		if (hostId !== this.hostId) {
			ws.close(4403, "hostId mismatch");
			return;
		}
		const resume = url.searchParams.get("resume") === "1";
		const invite = url.searchParams.get("invite");
		if (!resume && !this.invites.has(invite)) {
			ws.close(4403, "invite invalid");
			return;
		}
		const ticket = `ticket-${String(this.tickets.size + 1)}`;
		const expiresAt = Date.now() + 15_000;
		this.tickets.set(ticket, { expiresAt });
		this.phones.set(ticket, ws);
		ws.on("message", (data) => {
			const peer = this.accepts.get(ticket);
			if (peer && peer.readyState === WebSocket.OPEN) peer.send(data);
		});
		ws.on("close", () => {
			this.phones.delete(ticket);
			const peer = this.accepts.get(ticket);
			if (peer) peer.close();
		});
		this.host.send(JSON.stringify({ type: "phone_waiting", ticket, expiresAt }));
	}

	#acceptSocket(ticket, ws) {
		if (!this.tickets.has(ticket)) {
			ws.close(4403, "ticket invalid");
			return;
		}
		this.tickets.delete(ticket);
		this.accepts.set(ticket, ws);
		ws.on("message", (data) => {
			const peer = this.phones.get(ticket);
			if (peer && peer.readyState === WebSocket.OPEN) peer.send(data);
		});
		ws.on("close", () => {
			this.accepts.delete(ticket);
			const peer = this.phones.get(ticket);
			if (peer) peer.close();
		});
	}
}
