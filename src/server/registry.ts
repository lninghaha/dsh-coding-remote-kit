/**
 * Device registry, pending-offer registry, and the audit log.
 *
 * The device registry persists to `devices.json` and stores only the SHA-256
 * hash of each device token (compared with `timingSafeEqual`). Pending pairing
 * offers are ephemeral (in memory) with a TTL and a hard cap of 5; audit events
 * append to `audit.jsonl` and never include tokens, keys, or payloads.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { base64UrlEncode } from "../shared/base64.js";
import { DEVICE_SCOPE, MAX_PENDING_OFFERS } from "../shared/constants.js";
import { formatPairCode, normalizePairCode, pairCodeFromBytes } from "../shared/pair-code.js";
import type { PairingOffer } from "../shared/offer.js";
import { constantTimeEqualHex, randomBytes } from "./crypto.js";
import { appendJsonLine, readJsonFile, writeFileAtomic } from "./storage.js";

export type NetworkReach = "this-computer" | "lan";

export interface DeviceRecord {
	readonly deviceId: string;
	readonly tokenHash: string;
	readonly phonePublicKeyB64?: string;
	readonly scope: typeof DEVICE_SCOPE;
	readonly createdAt: number;
	readonly lastSeenAt: number;
	readonly revokedAt?: number;
}

export interface DevicesFile {
	devices: DeviceRecord[];
	networkReach: NetworkReach;
}

export interface AuditEntry {
	readonly ts: number;
	readonly event: string;
	readonly deviceId?: string;
	readonly detail?: Record<string, unknown>;
}

function defaultDevicesFile(): DevicesFile {
	return { devices: [], networkReach: "this-computer" };
}

export class DeviceRegistry {
	readonly #devices: DeviceRecord[];
	#networkReach: NetworkReach;
	readonly #path: string;

	constructor(storageDirectory: string) {
		this.#path = join(storageDirectory, "devices.json");
		const loaded = readJsonFile<DevicesFile>(this.#path) ?? defaultDevicesFile();
		this.#devices = Array.isArray(loaded.devices) ? loaded.devices : [];
		this.#networkReach = loaded.networkReach === "lan" ? "lan" : "this-computer";
	}

	get devices(): readonly DeviceRecord[] {
		return this.#devices;
	}

	get networkReach(): NetworkReach {
		return this.#networkReach;
	}

	setNetworkReach(value: NetworkReach): void {
		this.#networkReach = value;
		this.save();
	}

	/** Number of active (not revoked, seen at least once) devices. */
	activeDeviceCount(): number {
		return this.#devices.filter((device) => device.revokedAt === undefined && device.lastSeenAt > 0).length;
	}

	hasActiveDevice(): boolean {
		return this.#devices.some((device) => device.revokedAt === undefined && device.lastSeenAt > 0);
	}

	findById(deviceId: string): DeviceRecord | null {
		return this.#devices.find((device) => device.deviceId === deviceId) ?? null;
	}

	/** Look up a device by token hash (constant-time comparison). */
	findByTokenHash(tokenHash: string): DeviceRecord | null {
		for (const device of this.#devices) {
			if (constantTimeEqualHex(device.tokenHash, tokenHash)) return device;
		}
		return null;
	}

	isRevoked(device: DeviceRecord): boolean {
		return device.revokedAt !== undefined;
	}

	/**
	 * On a successful authentication: create a device for a new token, or
	 * refresh `lastSeenAt` / `phonePublicKeyB64` for an existing one.
	 */
	upsertDevice(input: { tokenHash: string; phonePublicKeyB64?: string }, now: number): DeviceRecord {
		const existing = this.findByTokenHash(input.tokenHash);
		if (existing !== null && existing.revokedAt === undefined) {
			const updated: DeviceRecord = {
				...existing,
				lastSeenAt: now,
				...(input.phonePublicKeyB64 === undefined ? {} : { phonePublicKeyB64: input.phonePublicKeyB64 }),
			};
			const index = this.#devices.indexOf(existing);
			this.#devices[index] = updated;
			this.save();
			return updated;
		}
		const created: DeviceRecord = {
			deviceId: randomUUID(),
			tokenHash: input.tokenHash,
			scope: DEVICE_SCOPE,
			createdAt: now,
			lastSeenAt: now,
			...(input.phonePublicKeyB64 === undefined ? {} : { phonePublicKeyB64: input.phonePublicKeyB64 }),
		};
		this.#devices.push(created);
		this.save();
		return created;
	}

	revoke(deviceId: string, now: number): DeviceRecord | null {
		const device = this.findById(deviceId);
		if (device === null) return null;
		const revoked: DeviceRecord = { ...device, revokedAt: now };
		const index = this.#devices.indexOf(device);
		this.#devices[index] = revoked;
		this.save();
		return revoked;
	}

	touch(deviceId: string, now: number): void {
		const device = this.findById(deviceId);
		if (device === null || device.revokedAt !== undefined) return;
		const updated: DeviceRecord = { ...device, lastSeenAt: now };
		this.#devices[this.#devices.indexOf(device)] = updated;
		this.save();
	}

	save(): void {
		const file: DevicesFile = { devices: this.#devices, networkReach: this.#networkReach };
		writeFileAtomic(this.#path, JSON.stringify(file, null, 2));
	}
}

export interface CreateOfferInput {
	readonly endpoint: string;
	readonly pageUrl: string;
	readonly publicKeyB64: string;
	readonly ttlMs: number;
	readonly now?: number;
}

export interface CreatedOffer {
	readonly offer: PairingOffer;
	readonly pairCode: string;
}

export class OfferRegistry {
	readonly #pending = new Map<string, PairingOffer>();
	readonly #order: string[] = [];
	readonly #codes = new Map<string, string>();

	createOffer(input: CreateOfferInput): CreatedOffer {
		const now = input.now ?? Date.now();
		const offer: PairingOffer = {
			v: 1,
			endpoint: input.endpoint,
			pageUrl: input.pageUrl,
			deviceToken: base64UrlEncode(randomBytes(32)),
			publicKeyB64: input.publicKeyB64,
			offerId: base64UrlEncode(randomBytes(16)),
			expiresAt: now + input.ttlMs,
		};
		const pairCode = this.#mintPairCode();
		this.#pending.set(offer.deviceToken, offer);
		this.#codes.set(pairCode, offer.deviceToken);
		this.#order.push(offer.deviceToken);
		while (this.#pending.size > MAX_PENDING_OFFERS) {
			const oldest = this.#order.shift();
			if (oldest === undefined) break;
			this.#forget(oldest);
		}
		return { offer, pairCode: formatPairCode(pairCode) };
	}

	count(): number {
		return this.#pending.size;
	}

	/** Find a live (non-expired) pending offer by device token. */
	findByToken(deviceToken: string, now: number = Date.now()): PairingOffer | null {
		const offer = this.#pending.get(deviceToken);
		if (offer === undefined) return null;
		if (offer.expiresAt <= now) {
			this.#forget(deviceToken);
			return null;
		}
		return offer;
	}

	/** Find a live offer by the short typed pairing PIN. */
	findByPairCode(pairCode: string, now: number = Date.now()): PairingOffer | null {
		const token = this.#codes.get(normalizePairCode(pairCode));
		if (token === undefined) return null;
		return this.findByToken(token, now);
	}

	/** Consume (remove) a pending offer, returning it only if live. */
	consumeByToken(deviceToken: string, now: number = Date.now()): PairingOffer | null {
		const offer = this.#pending.get(deviceToken);
		if (offer === undefined) return null;
		if (offer.expiresAt <= now) {
			this.#forget(deviceToken);
			return null;
		}
		this.#forget(deviceToken);
		return offer;
	}

	#mintPairCode(): string {
		for (let attempt = 0; attempt < 8; attempt += 1) {
			const code = pairCodeFromBytes(randomBytes(8));
			if (!this.#codes.has(code)) return code;
		}
		return pairCodeFromBytes(randomBytes(8));
	}

	#forget(deviceToken: string): void {
		this.#pending.delete(deviceToken);
		for (const [code, token] of this.#codes) {
			if (token === deviceToken) this.#codes.delete(code);
		}
		const index = this.#order.indexOf(deviceToken);
		if (index >= 0) this.#order.splice(index, 1);
	}
}

export class AuditLogger {
	readonly #path: string;

	constructor(storageDirectory: string) {
		this.#path = join(storageDirectory, "audit.jsonl");
	}

	log(entry: Omit<AuditEntry, "ts">, now: number = Date.now()): void {
		const record: AuditEntry = {
			ts: now,
			event: entry.event,
			...(entry.deviceId === undefined ? {} : { deviceId: entry.deviceId }),
			...(entry.detail === undefined ? {} : { detail: entry.detail }),
		};
		appendJsonLine(this.#path, record);
	}
}
