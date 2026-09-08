/**
 * Persist the last successful pairing offer on the phone page so a refresh
 * can resume over the rendezvous Worker without scanning again.
 */

import { type PairingOffer, validateOffer } from "../shared/offer.js";

export const HOST_STORAGE_KEY = "dshmr.host";
export const OFFER_STORAGE_KEY = "dshmr.offer";

export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem?(key: string): void;
}

/** Tab-scoped UI key: host public key + device + session prevent cross-pair leaks. */
export function sessionUiKey(hostPublicKeyB64: string, deviceId: string, sessionId: string, field: string): string {
	return `dshmr.ui.${hostPublicKeyB64}.${deviceId}.${sessionId}.${field}`;
}

export function readSessionUi(storage: StorageLike, key: string): string | null {
	try { return storage.getItem(key); } catch { return null; }
}

export function writeSessionUi(storage: StorageLike, key: string, value: string): void {
	try { storage.setItem(key, value); } catch { /* session restore is best effort */ }
}

export function clearSessionUi(storage: StorageLike, key: string): void {
	try {
		if (storage.removeItem !== undefined) storage.removeItem(key);
		else storage.setItem(key, "");
	} catch { /* session restore is best effort */ }
}

export function persistOffer(storage: StorageLike, offer: PairingOffer): void {
	storage.setItem(HOST_STORAGE_KEY, offer.pageUrl);
	storage.setItem(OFFER_STORAGE_KEY, JSON.stringify(offer));
}

/** Only call after successful E2EE authentication: an invite is no longer needed. */
export function resumableOffer(offer: PairingOffer): PairingOffer {
	const endpoint = new URL(offer.endpoint);
	if (!/^\/v1\/phone\/[^/]+$/u.test(endpoint.pathname)) return offer;
	endpoint.searchParams.delete("invite");
	endpoint.searchParams.set("resume", "1");
	return { ...offer, endpoint: endpoint.href };
}

export function loadPersistedOffer(storage: StorageLike): PairingOffer | null {
	const raw = storage.getItem(OFFER_STORAGE_KEY);
	if (raw === null || raw.length === 0) return null;
	try {
		return validateOffer(JSON.parse(raw) as unknown);
	} catch {
		return null;
	}
}

export function clearPersistedOffer(storage: StorageLike): void {
	try {
		if (typeof storage.removeItem === "function") {
			storage.removeItem(HOST_STORAGE_KEY);
			storage.removeItem(OFFER_STORAGE_KEY);
		} else {
			storage.setItem(HOST_STORAGE_KEY, "");
			storage.setItem(OFFER_STORAGE_KEY, "");
		}
	} catch {
		// ignore
	}
}

/** Copy a durable localStorage offer into sessionStorage once, then drop the durable copy. */
export function migratePersistedOffer(session: StorageLike, durable: StorageLike): PairingOffer | null {
	const fromSession = loadPersistedOffer(session);
	if (fromSession !== null) return fromSession;
	const fromDurable = loadPersistedOffer(durable);
	if (fromDurable === null) return null;
	persistOffer(session, fromDurable);
	clearPersistedOffer(durable);
	return fromDurable;
}

export interface ReadingPosition {
 readonly top: number;
 readonly firstSeq: number | null;
 readonly atEnd: boolean;
}
export function readReadingPosition(storage: StorageLike, key: string): ReadingPosition | null {
 try {
  const raw = readSessionUi(storage, key);
  if (raw === null) return null;
  const value = JSON.parse(raw) as Partial<ReadingPosition> | null;
  if (value === null || typeof value.top !== "number" || !Number.isFinite(value.top) || value.top < 0 ||
   typeof value.atEnd !== "boolean" || !(value.firstSeq === null || (typeof value.firstSeq === "number" && Number.isFinite(value.firstSeq)))) return null;
  return { top: value.top, firstSeq: value.firstSeq, atEnd: value.atEnd };
 } catch { return null; }
}
