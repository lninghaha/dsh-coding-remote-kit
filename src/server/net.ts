/**
 * Endpoint advertisement address selection.
 *
 * After the data plane widens to `0.0.0.0`, the pairing offer advertises a
 * concrete IPv4 address from `os.networkInterfaces()`. Priority favours
 * Tailscale (100.64.0.0/10), then RFC1918 private ranges, then anything else.
 */

import { networkInterfaces } from "node:os";

function priority(address: string): number {
	const parts = address.split(".");
	if (parts.length !== 4) return 3;
	const first = Number(parts[0]);
	const second = Number(parts[1]);
	if (first === 100 && second >= 64 && second <= 127) return 0; // Tailscale / CGNAT
	if (first === 10) return 1;
	if (first === 172 && second >= 16 && second <= 31) return 1;
	if (first === 192 && second === 168) return 1;
	return 2;
}

/** Distinct IPv4 (non-internal) addresses, best candidate first. */
export function networkCandidates(): string[] {
	const seen = new Set<string>();
	const addresses: string[] = [];
	for (const entries of Object.values(networkInterfaces())) {
		for (const entry of entries ?? []) {
			if (entry.family !== "IPv4" || entry.internal) continue;
			if (seen.has(entry.address)) continue;
			seen.add(entry.address);
			addresses.push(entry.address);
		}
	}
	return addresses.sort((a, b) => priority(a) - priority(b) || a.localeCompare(b));
}
