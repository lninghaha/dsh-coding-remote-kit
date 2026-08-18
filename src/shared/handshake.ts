/**
 * Handshake message construction and validation (dshmr-e2ee v1).
 *
 * The 4-step 2-RTT handshake:
 *
 *   C→S e2ee_hello        (plaintext)
 *   S→C e2ee_ready        (plaintext)
 *   C→S e2ee_auth         (encrypted)
 *   S→C e2ee_authenticated (encrypted)  |  e2ee_error → close 4001
 *
 * Only the message shapes, transcript, and shared-secret derivation live here;
 * the two transports (server / mobile) apply their own HKDF (node:crypto vs
 * pure JS) and their own key-pinning checks on top.
 */

import nacl from "tweetnacl";
import {
	DEVICE_SCOPE,
	DSH_VERSION,
	E2EE_VERSION,
	FRAMING,
	HANDSHAKE_CONTEXT,
	MIN_COMPATIBLE_MOBILE_VERSION,
	MOBILE_PROTOCOL_VERSION,
	PAYLOAD_KINDS,
	PLUGIN_VERSION,
} from "./constants.js";
import { base64Decode, base64Encode } from "./base64.js";
import { sha256Bytes } from "./hkdf.js";
import { buildTranscript, type TranscriptMessage } from "./transcript.js";
import { assertExactKeys, assertInteger, assertString, ProtocolValidationError } from "./validation.js";

export interface HelloCapabilities {
	readonly framing: number[];
	readonly payloadKinds: string[];
}

export interface HandshakeContext {
	readonly protocol: string;
	readonly initiator: string;
	readonly responder: string;
	readonly transport: string;
}

export interface HelloMessage {
	readonly type: "e2ee_hello";
	readonly v: number;
	readonly clientPublicKeyB64: string;
	readonly clientNonceB64: string;
	readonly capabilities: HelloCapabilities;
	readonly context: HandshakeContext;
}

export interface ReadyMessage {
	readonly type: "e2ee_ready";
	readonly v: number;
	readonly serverPublicKeyB64: string;
	readonly clientNonceB64: string;
	readonly serverNonceB64: string;
	readonly selection: HelloCapabilities;
	readonly context: HandshakeContext;
}

export interface AuthMessage {
	readonly type: "e2ee_auth";
	readonly v: number;
	readonly transcriptHashB64: string;
	readonly deviceToken: string;
}

export interface AuthenticatedMessage {
	readonly type: "e2ee_authenticated";
	readonly v: number;
	readonly transcriptHashB64: string;
	readonly deviceId: string;
	readonly protocolVersion: number;
	readonly minCompatibleMobileVersion: number;
}

export interface E2eeErrorMessage {
	readonly type: "e2ee_error";
	readonly error: { readonly code: "bad_auth" | "unauthorized" };
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
	}
	if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
		const aKeys = Object.keys(a as Record<string, unknown>);
		const bKeys = Object.keys(b as Record<string, unknown>);
		if (aKeys.length !== bKeys.length) return false;
		return aKeys.every((key) => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
	}
	return false;
}

/** Canonical base64 of exactly 32 bytes, or throw. */
export function decodeKeyB64(value: unknown, field: string): Uint8Array {
	assertString(value, field);
	try {
		const decoded = base64Decode(value);
		if (decoded.length !== 32) throw new Error("not 32 bytes");
		return decoded;
	} catch {
		throw new ProtocolValidationError(`${field} is not canonical base64 of 32 bytes`);
	}
}

function validateCapabilities(value: unknown, field: string): HelloCapabilities {
	assertExactKeys(value, ["framing", "payloadKinds"]);
	if (!Array.isArray(value.framing)) throw new ProtocolValidationError(`${field}.framing must be an array`);
	if (!Array.isArray(value.payloadKinds)) throw new ProtocolValidationError(`${field}.payloadKinds must be an array`);
	const capabilities: HelloCapabilities = {
		framing: value.framing as number[],
		payloadKinds: value.payloadKinds as string[],
	};
	if (!deepEqual(capabilities.framing, [FRAMING])) {
		throw new ProtocolValidationError(`${field}.framing must be [${FRAMING}]`);
	}
	if (!deepEqual(capabilities.payloadKinds, [...PAYLOAD_KINDS])) {
		throw new ProtocolValidationError(`${field}.payloadKinds must be [${PAYLOAD_KINDS.join(", ")}]`);
	}
	return capabilities;
}

function validateContext(value: unknown): HandshakeContext {
	assertExactKeys(value, ["protocol", "initiator", "responder", "transport"]);
	const context = value as unknown as HandshakeContext;
	if (
		context.protocol !== HANDSHAKE_CONTEXT.protocol ||
		context.initiator !== HANDSHAKE_CONTEXT.initiator ||
		context.responder !== HANDSHAKE_CONTEXT.responder ||
		context.transport !== HANDSHAKE_CONTEXT.transport
	) {
		throw new ProtocolValidationError("context does not match the frozen handshake context");
	}
	return HANDSHAKE_CONTEXT;
}

/** Build a plaintext e2ee_hello from a client keypair and nonce. */
export function buildHello(clientPublicKey: Uint8Array, clientNonce: Uint8Array): HelloMessage {
	return {
		type: "e2ee_hello",
		v: E2EE_VERSION,
		clientPublicKeyB64: base64Encode(clientPublicKey),
		clientNonceB64: base64Encode(clientNonce),
		capabilities: { framing: [FRAMING], payloadKinds: [...PAYLOAD_KINDS] },
		context: { ...HANDSHAKE_CONTEXT },
	};
}

export interface ParsedHello {
	readonly clientPublicKey: Uint8Array;
	readonly clientNonce: Uint8Array;
	readonly message: HelloMessage;
}

/** Validate a received e2ee_hello (exact keys, version, canonical base64). */
export function validateHello(value: unknown): ParsedHello {
	assertExactKeys(value, ["type", "v", "clientPublicKeyB64", "clientNonceB64", "capabilities", "context"]);
	if (value.type !== "e2ee_hello") throw new ProtocolValidationError("unexpected message type");
	assertInteger(value.v, "v");
	if (value.v !== E2EE_VERSION) throw new ProtocolValidationError("unsupported e2ee version");
	const clientPublicKey = decodeKeyB64(value.clientPublicKeyB64, "clientPublicKeyB64");
	const clientNonce = decodeKeyB64(value.clientNonceB64, "clientNonceB64");
	const capabilities = validateCapabilities(value.capabilities, "capabilities");
	const context = validateContext(value.context);
	return {
		clientPublicKey,
		clientNonce,
		message: {
			type: "e2ee_hello",
			v: E2EE_VERSION,
			clientPublicKeyB64: value.clientPublicKeyB64 as string,
			clientNonceB64: value.clientNonceB64 as string,
			capabilities,
			context,
		},
	};
}

/** Build a plaintext e2ee_ready echoing the client nonce and context. */
export function buildReady(
	serverPublicKey: Uint8Array,
	clientNonce: Uint8Array,
	serverNonce: Uint8Array,
	context: HandshakeContext,
): ReadyMessage {
	return {
		type: "e2ee_ready",
		v: E2EE_VERSION,
		serverPublicKeyB64: base64Encode(serverPublicKey),
		clientNonceB64: base64Encode(clientNonce),
		serverNonceB64: base64Encode(serverNonce),
		selection: { framing: [FRAMING], payloadKinds: [...PAYLOAD_KINDS] },
		context: { ...context },
	};
}

export interface ParsedReady {
	readonly serverPublicKey: Uint8Array;
	readonly clientNonce: Uint8Array;
	readonly serverNonce: Uint8Array;
	readonly message: ReadyMessage;
}

/** Validate a received e2ee_ready (exact keys, version, canonical base64). */
export function validateReady(value: unknown): ParsedReady {
	assertExactKeys(value, ["type", "v", "serverPublicKeyB64", "clientNonceB64", "serverNonceB64", "selection", "context"]);
	if (value.type !== "e2ee_ready") throw new ProtocolValidationError("unexpected message type");
	assertInteger(value.v, "v");
	if (value.v !== E2EE_VERSION) throw new ProtocolValidationError("unsupported e2ee version");
	const serverPublicKey = decodeKeyB64(value.serverPublicKeyB64, "serverPublicKeyB64");
	const clientNonce = decodeKeyB64(value.clientNonceB64, "clientNonceB64");
	const serverNonce = decodeKeyB64(value.serverNonceB64, "serverNonceB64");
	const selection = validateCapabilities(value.selection, "selection");
	const context = validateContext(value.context);
	return {
		serverPublicKey,
		clientNonce,
		serverNonce,
		message: {
			type: "e2ee_ready",
			v: E2EE_VERSION,
			serverPublicKeyB64: value.serverPublicKeyB64 as string,
			clientNonceB64: value.clientNonceB64 as string,
			serverNonceB64: value.serverNonceB64 as string,
			selection,
			context,
		},
	};
}

/** X25519 shared secret via nacl.box.before(peerPublicKey, ownSecretKey). */
export function computeSharedSecret(peerPublicKey: Uint8Array, ownSecretKey: Uint8Array): Uint8Array {
	return nacl.box.before(peerPublicKey, ownSecretKey);
}

/** SHA-256 of the hello+ready transcript. */
export function computeTranscriptHash(hello: object, ready: object): Uint8Array {
	return sha256Bytes(buildTranscript(hello as TranscriptMessage, ready as TranscriptMessage));
}

/** Build an encrypted e2ee_auth. */
export function buildAuth(transcriptHash: Uint8Array, deviceToken: string): AuthMessage {
	return {
		type: "e2ee_auth",
		v: E2EE_VERSION,
		transcriptHashB64: base64Encode(transcriptHash),
		deviceToken,
	};
}

export interface ParsedAuth {
	readonly transcriptHash: Uint8Array;
	readonly deviceToken: string;
}

/** Validate a received e2ee_auth (exactly 4 keys). */
export function validateAuth(value: unknown): ParsedAuth {
	assertExactKeys(value, ["type", "v", "transcriptHashB64", "deviceToken"]);
	if (value.type !== "e2ee_auth") throw new ProtocolValidationError("unexpected message type");
	assertInteger(value.v, "v");
	if (value.v !== E2EE_VERSION) throw new ProtocolValidationError("unsupported e2ee version");
	const transcriptHash = decodeKeyB64(value.transcriptHashB64, "transcriptHashB64");
	assertString(value.deviceToken, "deviceToken");
	return { transcriptHash, deviceToken: value.deviceToken };
}

/** Build an encrypted e2ee_authenticated (exactly 6 keys). */
export function buildAuthenticated(
	transcriptHash: Uint8Array,
	deviceId: string,
	protocolVersion: number,
	minCompatibleMobileVersion: number,
): AuthenticatedMessage {
	return {
		type: "e2ee_authenticated",
		v: E2EE_VERSION,
		transcriptHashB64: base64Encode(transcriptHash),
		deviceId,
		protocolVersion,
		minCompatibleMobileVersion,
	};
}

export interface ParsedAuthenticated {
	readonly transcriptHash: Uint8Array;
	readonly deviceId: string;
	readonly protocolVersion: number;
	readonly minCompatibleMobileVersion: number;
}

/** Validate a received e2ee_authenticated (exactly 6 keys). */
export function validateAuthenticated(value: unknown): ParsedAuthenticated {
	assertExactKeys(value, ["type", "v", "transcriptHashB64", "deviceId", "protocolVersion", "minCompatibleMobileVersion"]);
	if (value.type !== "e2ee_authenticated") throw new ProtocolValidationError("unexpected message type");
	assertInteger(value.v, "v");
	if (value.v !== E2EE_VERSION) throw new ProtocolValidationError("unsupported e2ee version");
	const transcriptHash = decodeKeyB64(value.transcriptHashB64, "transcriptHashB64");
	assertString(value.deviceId, "deviceId");
	assertInteger(value.protocolVersion, "protocolVersion");
	assertInteger(value.minCompatibleMobileVersion, "minCompatibleMobileVersion");
	return {
		transcriptHash,
		deviceId: value.deviceId,
		protocolVersion: value.protocolVersion,
		minCompatibleMobileVersion: value.minCompatibleMobileVersion,
	};
}

/** Build a plaintext/encrypted e2ee_error. */
export function buildE2eeError(code: "bad_auth" | "unauthorized"): E2eeErrorMessage {
	return { type: "e2ee_error", error: { code } };
}

/** The `status.get` result shape the mobile page consumes for the version gate. */
export function statusGetResult(): Record<string, unknown> {
	return {
		protocolVersion: MOBILE_PROTOCOL_VERSION,
		minCompatibleMobileVersion: MIN_COMPATIBLE_MOBILE_VERSION,
		pluginVersion: PLUGIN_VERSION,
		dshVersion: DSH_VERSION,
		deviceScope: DEVICE_SCOPE,
	};
}
