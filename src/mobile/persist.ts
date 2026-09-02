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

export function persistOffer(storage: StorageLike, offer: PairingOffer): void {
	storage.setItem(HOST_STORAGE_KEY, offer.pageUrl);
	storage.setItem(OFFER_STORAGE_KEY, JSON.stringify(offer));
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
