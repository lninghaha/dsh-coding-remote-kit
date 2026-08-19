/**
 * Persist the last successful pairing offer on the phone page so a refresh
 * can resume over the rendezvous Worker without scanning again.
 */

import { validateOffer, type PairingOffer } from "../shared/offer.js";

export const HOST_STORAGE_KEY = "dshmr.host";
export const OFFER_STORAGE_KEY = "dshmr.offer";

export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
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
