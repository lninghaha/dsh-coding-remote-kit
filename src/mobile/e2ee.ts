/**
 * Mobile-side E2EE handshake + session framing (dshmr-e2ee v1).
 *
 * Uses the pure-JS `shared/hkdf.ts` (js-sha256) key schedule — the node
 * `hkdfSync` counterpart lives in `server/crypto.ts` and the cross-end test
 * pins both to the same vector. The pairing offer's `publicKeyB64` is pinned:
 * a mismatched server key aborts before any key is derived.
 */

import nacl from "tweetnacl";
import {
	DIRECTION_MOBILE_TO_SERVER,
	DIRECTION_SERVER_TO_MOBILE,
	PAYLOAD_KIND_TEXT,
} from "../shared/constants.js";
import { open, seal } from "../shared/frame.js";
import {
	buildAuth,
	buildHello,
	computeSharedSecret,
	computeTranscriptHash,
	decodeKeyB64,
	validateAuthenticated,
	validateReady,
	type AuthMessage,
	type ClientMetadata,
	type HelloMessage,
	type ReadyMessage,
} from "../shared/handshake.js";
import { deriveSessionKeys, type SessionKeys } from "../shared/hkdf.js";
import { constantTimeEqual } from "../shared/validation.js";
import type { VersionStatus } from "../shared/version.js";

export interface MobileE2eeSessionOptions {
	readonly clientSecretKey: Uint8Array;
	readonly clientPublicKey: Uint8Array;
	readonly pinnedPublicKeyB64: string;
}

export type ReadyOutcome =
	| { readonly ok: true; readonly ready: ReadyMessage }
	| { readonly ok: false; readonly reason: "pinned-key-mismatch" | "invalid" };

export type AuthenticatedOutcome =
	| { readonly ok: true; readonly status: VersionStatus }
	| { readonly ok: false; readonly reason: "transcript-mismatch" | "invalid" };

export function generateClientKeyPair(): { readonly secretKey: Uint8Array; readonly publicKey: Uint8Array } {
	const keyPair = nacl.box.keyPair();
	return { secretKey: keyPair.secretKey, publicKey: keyPair.publicKey };
}

export class MobileE2eeSession {
	readonly #clientSecretKey: Uint8Array;
	readonly #pinnedPublicKey: Uint8Array;
	readonly #clientNonce: Uint8Array = nacl.randomBytes(32);
	readonly #hello: HelloMessage;

	#ready?: ReadyMessage;
	#transcriptHash?: Uint8Array;
	#keys?: SessionKeys;
	#sendCounter = 0;
	#recvCounter = 0;
	#consecutiveFailures = 0;

	constructor(options: MobileE2eeSessionOptions) {
		this.#clientSecretKey = options.clientSecretKey;
		this.#pinnedPublicKey = decodeKeyB64(options.pinnedPublicKeyB64, "publicKeyB64");
		this.#hello = buildHello(options.clientPublicKey, this.#clientNonce);
	}

	get hello(): HelloMessage {
		return this.#hello;
	}

	get consecutiveFailures(): number {
		return this.#consecutiveFailures;
	}

	/** Validate e2ee_ready; pin-check the server key before deriving anything. */
	receiveReady(ready: unknown): ReadyOutcome {
		try {
			const parsed = validateReady(ready);
			if (!constantTimeEqual(parsed.serverPublicKey, this.#pinnedPublicKey)) {
				return { ok: false, reason: "pinned-key-mismatch" };
			}
			this.#ready = parsed.message;
			this.#transcriptHash = computeTranscriptHash(this.#hello, this.#ready);
			const shared = computeSharedSecret(parsed.serverPublicKey, this.#clientSecretKey);
			this.#keys = deriveSessionKeys(shared, this.#clientNonce, parsed.serverNonce, this.#transcriptHash);
			return { ok: true, ready: parsed.message };
		} catch {
			return { ok: false, reason: "invalid" };
		}
	}

	auth(
		deviceToken: string,
		identity: { readonly deviceName?: string; readonly clientMetadata?: ClientMetadata } = {},
	): AuthMessage {
		if (this.#transcriptHash === undefined) throw new Error("handshake not ready");
		return buildAuth(this.#transcriptHash, deviceToken, identity);
	}

	receiveAuthenticated(authenticated: unknown): AuthenticatedOutcome {
		try {
			const parsed = validateAuthenticated(authenticated);
			if (this.#transcriptHash === undefined || !constantTimeEqual(parsed.transcriptHash, this.#transcriptHash)) {
				return { ok: false, reason: "transcript-mismatch" };
			}
			return {
				ok: true,
				status: {
					protocolVersion: parsed.protocolVersion,
					minCompatibleMobileVersion: parsed.minCompatibleMobileVersion,
				},
			};
		} catch {
			return { ok: false, reason: "invalid" };
		}
	}

	sealOut(payload: Uint8Array): Uint8Array {
		if (this.#keys === undefined) throw new Error("session keys are not ready");
		const counter = this.#sendCounter;
		this.#sendCounter += 1;
		return seal(
			this.#keys.mobileToServerKey,
			this.#keys.sessionId,
			DIRECTION_MOBILE_TO_SERVER,
			PAYLOAD_KIND_TEXT,
			counter,
			payload,
		);
	}

	openIn(sealedBytes: Uint8Array): Uint8Array | null {
		if (this.#keys === undefined) return null;
		const counter = this.#recvCounter;
		const payload = open(
			sealedBytes,
			this.#keys.serverToMobileKey,
			this.#keys.sessionId,
			DIRECTION_SERVER_TO_MOBILE,
			PAYLOAD_KIND_TEXT,
			counter,
		);
		if (payload === null) {
			this.#consecutiveFailures += 1;
			return null;
		}
		this.#consecutiveFailures = 0;
		this.#recvCounter = counter + 1;
		return payload;
	}
}
