/**
 * Endpoint advertisement address selection.
 *
 * After the data plane widens to `0.0.0.0`, the pairing offer advertises a
 * concrete IPv4 address from `os.networkInterfaces()`. Priority favours
 * Tailscale (100.64.0.0/10), then RFC1918 private ranges, then anything else.
 */

import { networkInterfaces } from "node:os";

export type NetworkCandidateKind = "tailscale" | "rfc1918" | "other";

export interface SanitizedNetworkCandidate {
	readonly address: string;
	readonly kind: NetworkCandidateKind;
}

function priority(address: string): number {
	const kind = classifyNetworkAddress(address);
	if (kind === "tailscale") return 0;
	if (kind === "rfc1918") return 1;
	if (kind === "other") return 2;
	return 3;
}

/** Coarse address class for diagnostics (no interface metadata). */
export function classifyNetworkAddress(address: string): NetworkCandidateKind {
	const parts = address.split(".");
	if (parts.length !== 4) return "other";
	const first = Number(parts[0]);
	const second = Number(parts[1]);
	if (first === 100 && second >= 64 && second <= 127) return "tailscale";
	if (first === 10) return "rfc1918";
	if (first === 172 && second >= 16 && second <= 31) return "rfc1918";
	if (first === 192 && second === 168) return "rfc1918";
	return "other";
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

/** IPv4 + coarse kind only (no MAC / iface name / hostname). */
export function sanitizedNetworkCandidates(
	addresses: readonly string[] = networkCandidates(),
): SanitizedNetworkCandidate[] {
	return addresses.map((address) => ({ address, kind: classifyNetworkAddress(address) }));
}
