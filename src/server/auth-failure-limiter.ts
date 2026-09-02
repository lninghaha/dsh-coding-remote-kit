/**
 * Per-remote-address circuit breaker for WebSocket authentication failures.
 * Claim PIN rate limiting stays separate on the HTTP claim path.
 */

import { WS_AUTH_FAILURE_LIMIT, WS_AUTH_FAILURE_WINDOW_MS } from "../shared/constants.js";

export class AuthFailureLimiter {
	readonly #hits = new Map<string, number[]>();
	readonly #limit: number;
	readonly #windowMs: number;

	constructor(options?: { readonly limit?: number; readonly windowMs?: number }) {
		this.#limit = options?.limit ?? WS_AUTH_FAILURE_LIMIT;
		this.#windowMs = options?.windowMs ?? WS_AUTH_FAILURE_WINDOW_MS;
	}

	blocked(remoteAddress: string, now: number = Date.now()): boolean {
		const hits = this.#prune(remoteAddress, now);
		return hits.length >= this.#limit;
	}

	recordFailure(remoteAddress: string, now: number = Date.now()): void {
		const hits = this.#prune(remoteAddress, now);
		hits.push(now);
		this.#hits.set(remoteAddress, hits);
	}

	#prune(remoteAddress: string, now: number): number[] {
		const hits = (this.#hits.get(remoteAddress) ?? []).filter((time) => now - time < this.#windowMs);
		this.#hits.set(remoteAddress, hits);
		return hits;
	}
}
