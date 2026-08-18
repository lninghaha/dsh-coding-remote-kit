/**
 * Server-side E2EE handshake (dshmr-e2ee v1).
 *
 * `ServerHandshake` is a pure state machine — no sockets — so the process-level
 * handshake test can drive both ends in-process. Token resolution is a
 * callback, keeping the crypto independent of the device/offer registries.
 */

import {
	HANDSHAKE_CONTEXT,
	MIN_COMPATIBLE_MOBILE_VERSION,
	MOBILE_PROTOCOL_VERSION,
} from "../shared/constants.js";
import { utf8Encode } from "../shared/base64.js";
import {
	buildAuthenticated,
	buildReady,
	computeSharedSecret,
	computeTranscriptHash,
	validateAuth,
	validateHello,
	type AuthenticatedMessage,
	type HelloMessage,
	type ReadyMessage,
} from "../shared/handshake.js";
import { constantTimeEqual } from "../shared/validation.js";
import { deriveSessionKeysNode, randomBytes, sha256Hex } from "./crypto.js";
import type { DeviceRecord, OfferRegistry, DeviceRegistry, AuditLogger } from "./registry.js";

export type TokenResolution =
	| { readonly kind: "ok"; readonly device: DeviceRecord }
	| { readonly kind: "bad_auth"; readonly reason: string }
	| { readonly kind: "unauthorized" };

export type ResolveToken = (deviceToken: string) => TokenResolution;

/**
 * Resolve a presented device token against the device registry and pending
 * offers. First-auth tokens live in a pending offer; re-auth tokens match an
 * existing device's token hash (constant-time). Revoked devices are
 * `unauthorized`; everything else is `bad_auth`.
 */
export function resolveDeviceToken(
	deviceToken: string,
	deps: {
		readonly registry: DeviceRegistry;
		readonly offers: OfferRegistry;
		readonly audit: AuditLogger;
		readonly now?: () => number;
	},
): TokenResolution {
	const now = deps.now?.() ?? Date.now();
	const tokenHash = sha256Hex(utf8Encode(deviceToken));
	const existing = deps.registry.findByTokenHash(tokenHash);
	if (existing !== null) {
		if (existing.revokedAt !== undefined) {
			deps.audit.log({ event: "auth_failed", detail: { reason: "revoked" } }, now);
			return { kind: "unauthorized" };
		}
		return { kind: "ok", device: existing };
	}
	const offer = deps.offers.consumeByToken(deviceToken, now);
	if (offer === null) {
		deps.audit.log({ event: "auth_failed", detail: { reason: "bad_auth" } }, now);
		return { kind: "bad_auth", reason: "bad_auth" };
	}
	const device = deps.registry.upsertDevice({ tokenHash }, now);
	deps.audit.log({ event: "offer_consumed", deviceId: device.deviceId }, now);
	return { kind: "ok", device };
}

export interface ServerSessionKeys {
	readonly mobileToServerKey: Uint8Array;
	readonly serverToMobileKey: Uint8Array;
	readonly sessionId: Uint8Array;
}

export interface ServerHandshakeResult {
	readonly ok: boolean;
	readonly code?: "bad_auth" | "unauthorized";
	readonly ready?: ReadyMessage;
	readonly authenticated?: AuthenticatedMessage;
	readonly deviceId?: string;
	readonly keys?: ServerSessionKeys;
}

export class ServerHandshake {
	readonly #serverSecretKey: Uint8Array;
	readonly #serverPublicKey: Uint8Array;
	readonly #resolveToken: ResolveToken;

	#hello?: HelloMessage;
	#ready?: ReadyMessage;
	#clientPublicKey?: Uint8Array;
	#clientNonce?: Uint8Array;
	#serverNonce?: Uint8Array;
	#transcriptHash?: Uint8Array;

	constructor(
		serverKeyPair: { readonly secretKey: Uint8Array; readonly publicKey: Uint8Array },
		resolveToken: ResolveToken,
	) {
		this.#serverSecretKey = serverKeyPair.secretKey;
		this.#serverPublicKey = serverKeyPair.publicKey;
		this.#resolveToken = resolveToken;
	}

	/** Handle a plaintext e2ee_hello; return the ready message or a bad_auth. */
	start(hello: unknown): { readonly ok: true; readonly ready: ReadyMessage } | { readonly ok: false; readonly code: "bad_auth" } {
		try {
			const parsed = validateHello(hello);
			this.#hello = parsed.message;
			this.#clientPublicKey = parsed.clientPublicKey;
			this.#clientNonce = parsed.clientNonce;
			this.#serverNonce = randomBytes(32);
			const ready = buildReady(this.#serverPublicKey, parsed.clientNonce, this.#serverNonce, HANDSHAKE_CONTEXT);
			this.#ready = ready;
			this.#transcriptHash = computeTranscriptHash(this.#hello, ready);
			return { ok: true, ready };
		} catch {
			return { ok: false, code: "bad_auth" };
		}
	}

	/** Derive the session keys (available after a successful `start`). */
	deriveKeys(): ServerSessionKeys | null {
		if (
			this.#clientPublicKey === undefined ||
			this.#clientNonce === undefined ||
			this.#serverNonce === undefined ||
			this.#transcriptHash === undefined
		) {
			return null;
		}
		const sharedSecret = computeSharedSecret(this.#clientPublicKey, this.#serverSecretKey);
		return deriveSessionKeysNode(sharedSecret, this.#clientNonce, this.#serverNonce, this.#transcriptHash);
	}

	/** Handle a decrypted e2ee_auth; return the authenticated message or an error. */
	finish(auth: unknown): ServerHandshakeResult {
		try {
			const parsed = validateAuth(auth);
			if (this.#transcriptHash === undefined || !constantTimeEqual(parsed.transcriptHash, this.#transcriptHash)) {
				return { ok: false, code: "bad_auth" };
			}
			const resolution = this.#resolveToken(parsed.deviceToken);
			if (resolution.kind === "unauthorized") return { ok: false, code: "unauthorized" };
			if (resolution.kind === "bad_auth") return { ok: false, code: "bad_auth" };
			const keys = this.deriveKeys();
			if (keys === null) return { ok: false, code: "bad_auth" };
			const authenticated = buildAuthenticated(
				this.#transcriptHash,
				resolution.device.deviceId,
				MOBILE_PROTOCOL_VERSION,
				MIN_COMPATIBLE_MOBILE_VERSION,
			);
			return { ok: true, authenticated, deviceId: resolution.device.deviceId, keys };
		} catch {
			return { ok: false, code: "bad_auth" };
		}
	}
}
