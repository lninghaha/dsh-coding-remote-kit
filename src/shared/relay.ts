/**
 * Outer rendezvous envelope (`dshmr-relay/v1`).
 *
 * The Worker parses only these control messages. After a phone socket is
 * spliced to a desktop accept socket, frames are forwarded as opaque bytes
 * and the inner `dshmr-e2ee/v1` handshake is unchanged (`transport: "direct"`).
 */

import { MAX_WS_PAYLOAD } from "./constants.js";
import { assertExactKeys, assertInteger, assertString, ProtocolValidationError } from "./validation.js";

export const RELAY_PROTOCOL = "dshmr-relay/v1";
export const RELAY_VERSION = 1;
export const RELAY_TICKET_TTL_MS = 15_000;
export const RELAY_MAX_UNAUTH_PHONES = 8;
export const RELAY_INVITE_BYTES = 24;
export const RELAY_TICKET_BYTES = 32;
export const RELAY_HOST_ID_BYTES = 16;
export const RELAY_MAX_FRAME_BYTES = MAX_WS_PAYLOAD;
export const RELAY_CLAIM_TIMEOUT_MS = 5_000;
export const RELAY_HELLO_TIMEOUT_MS = 15_000;

export interface RelayAdvertiseResult {
	readonly endpoint: string;
	readonly pageUrl: string;
	readonly candidates: string[];
}

export interface HostHelloMessage {
	readonly type: "host_hello";
	readonly v: number;
	readonly hostId: string;
	readonly hostToken: string;
}

export interface HostOkMessage {
	readonly type: "host_ok";
	readonly v: number;
	readonly hostId: string;
}

export interface HostErrorMessage {
	readonly type: "host_error";
	readonly error: { readonly code: "unauthorized" | "invalid" | "replaced" };
}

export interface InvitePutMessage {
	readonly type: "invite_put";
	readonly invite: string;
	readonly expiresAt: number;
	readonly offerId: string;
}

export interface InviteAckMessage {
	readonly type: "invite_ack";
	readonly offerId: string;
}

export interface ClaimMessage {
	readonly type: "claim";
	readonly requestId: string;
	readonly code: string;
}

export interface ClaimResultMessage {
	readonly type: "claim_result";
	readonly requestId: string;
	readonly offer?: unknown;
	readonly error?: { readonly code: string; readonly message: string };
}

export interface PhoneWaitingMessage {
	readonly type: "phone_waiting";
	readonly ticket: string;
	readonly expiresAt: number;
}

export interface PingMessage {
	readonly type: "ping";
}

export interface PongMessage {
	readonly type: "pong";
}

export type RelayControlMessage =
	| HostHelloMessage
	| HostOkMessage
	| HostErrorMessage
	| InvitePutMessage
	| InviteAckMessage
	| ClaimMessage
	| ClaimResultMessage
	| PhoneWaitingMessage
	| PingMessage
	| PongMessage;

/** Strip trailing slashes from an origin. */
export function stripOrigin(origin: string): string {
	return origin.replace(/\/+$/u, "");
}

/** Parse an absolute http(s) origin. Throws on anything else. */
export function parseRelayOrigin(value: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new ProtocolValidationError("relay origin is not a valid URL");
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new ProtocolValidationError("relay origin must be http(s)");
	}
	if (url.username !== "" || url.password !== "") {
		throw new ProtocolValidationError("relay origin must not include credentials");
	}
	return url;
}

/** Management plane: only https origins (tests may still start the client on loopback http). */
export function assertHttpsRelayOrigin(value: string): string {
	const url = parseRelayOrigin(value);
	if (url.protocol !== "https:") {
		throw new ProtocolValidationError("relay origin must be https");
	}
	return stripOrigin(url.origin);
}

/** Convert an http(s) origin to the matching ws(s) origin. */
export function wsOriginFromHttp(origin: string): string {
	const url = parseRelayOrigin(origin);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	return stripOrigin(url.origin);
}

/** Advertise a pairing offer through a connected rendezvous origin. */
export function relayAdvertise(origin: string, hostId: string, invite: string): RelayAdvertiseResult {
	const httpOrigin = stripOrigin(parseRelayOrigin(origin).origin);
	const wsOrigin = wsOriginFromHttp(httpOrigin);
	const host = new URL(httpOrigin).host;
	return {
		endpoint: `${wsOrigin}/v1/phone/${encodeURIComponent(hostId)}?invite=${encodeURIComponent(invite)}`,
		pageUrl: `${httpOrigin}/m/`,
		candidates: [host],
	};
}

/** Resume URL (no invite). Phone still authenticates with e2ee_auth. */
export function relayResumeEndpoint(origin: string, hostId: string): string {
	const wsOrigin = wsOriginFromHttp(origin);
	return `${wsOrigin}/v1/phone/${encodeURIComponent(hostId)}?resume=1`;
}

export function relayHostUrl(origin: string): string {
	return `${wsOriginFromHttp(origin)}/v1/host`;
}

export function relayAcceptUrl(origin: string, ticket: string): string {
	return `${wsOriginFromHttp(origin)}/v1/accept/${encodeURIComponent(ticket)}`;
}

export function parseJsonObject(text: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text) as unknown;
	} catch {
		throw new ProtocolValidationError("relay message is not valid JSON");
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new ProtocolValidationError("relay message must be an object");
	}
	return parsed as Record<string, unknown>;
}

export function parseHostHello(value: unknown): HostHelloMessage {
	assertExactKeys(value, ["type", "v", "hostId", "hostToken"]);
	if (value.type !== "host_hello") throw new ProtocolValidationError("unexpected message type");
	assertInteger(value.v, "v");
	if (value.v !== RELAY_VERSION) throw new ProtocolValidationError("unsupported relay version");
	assertString(value.hostId, "hostId");
	assertString(value.hostToken, "hostToken");
	return { type: "host_hello", v: RELAY_VERSION, hostId: value.hostId, hostToken: value.hostToken };
}

export function parseHostOk(value: unknown): HostOkMessage {
	assertExactKeys(value, ["type", "v", "hostId"]);
	if (value.type !== "host_ok") throw new ProtocolValidationError("unexpected message type");
	assertInteger(value.v, "v");
	if (value.v !== RELAY_VERSION) throw new ProtocolValidationError("unsupported relay version");
	assertString(value.hostId, "hostId");
	return { type: "host_ok", v: RELAY_VERSION, hostId: value.hostId };
}

export function parseInvitePut(value: unknown): InvitePutMessage {
	assertExactKeys(value, ["type", "invite", "expiresAt", "offerId"]);
	if (value.type !== "invite_put") throw new ProtocolValidationError("unexpected message type");
	assertString(value.invite, "invite");
	assertInteger(value.expiresAt, "expiresAt");
	assertString(value.offerId, "offerId");
	return { type: "invite_put", invite: value.invite, expiresAt: value.expiresAt, offerId: value.offerId };
}

export function parseInviteAck(value: unknown): InviteAckMessage {
	assertExactKeys(value, ["type", "offerId"]);
	if (value.type !== "invite_ack") throw new ProtocolValidationError("unexpected message type");
	assertString(value.offerId, "offerId");
	return { type: "invite_ack", offerId: value.offerId };
}

export function parseClaim(value: unknown): ClaimMessage {
	assertExactKeys(value, ["type", "requestId", "code"]);
	if (value.type !== "claim") throw new ProtocolValidationError("unexpected message type");
	assertString(value.requestId, "requestId");
	assertString(value.code, "code");
	return { type: "claim", requestId: value.requestId, code: value.code };
}

export function parseClaimResult(value: unknown): ClaimResultMessage {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new ProtocolValidationError("expected an object");
	}
	const record = value as Record<string, unknown>;
	if (record.type !== "claim_result") throw new ProtocolValidationError("unexpected message type");
	assertString(record.requestId, "requestId");
	let error: ClaimResultMessage["error"];
	if (record.error !== undefined) {
		if (typeof record.error !== "object" || record.error === null || Array.isArray(record.error)) {
			throw new ProtocolValidationError("error must be an object");
		}
		const err = record.error as Record<string, unknown>;
		assertString(err.code, "error.code");
		assertString(err.message, "error.message");
		error = { code: err.code, message: err.message };
	}
	return {
		type: "claim_result",
		requestId: record.requestId,
		...(record.offer === undefined ? {} : { offer: record.offer }),
		...(error === undefined ? {} : { error }),
	};
}

export function parsePhoneWaiting(value: unknown): PhoneWaitingMessage {
	assertExactKeys(value, ["type", "ticket", "expiresAt"]);
	if (value.type !== "phone_waiting") throw new ProtocolValidationError("unexpected message type");
	assertString(value.ticket, "ticket");
	assertInteger(value.expiresAt, "expiresAt");
	return { type: "phone_waiting", ticket: value.ticket, expiresAt: value.expiresAt };
}

export function isPing(value: unknown): value is PingMessage {
	return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "ping";
}

export function isPong(value: unknown): value is PongMessage {
	return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "pong";
}

export function hostErrorCode(value: unknown): HostErrorMessage["error"]["code"] | null {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;
	if (record.type !== "host_error") return null;
	const error = record.error;
	if (typeof error !== "object" || error === null) return null;
	const code = (error as { code?: unknown }).code;
	if (code === "unauthorized" || code === "invalid" || code === "replaced") return code;
	return null;
}
