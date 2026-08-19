/**
 * Short human-typed pairing PIN (not the long fragment offer).
 * Alphabet is Crockford-like (no I/L/O/U) so similar glyphs collapse on input.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function normalizePairCode(input: string): string {
	let out = "";
	for (const raw of input.toUpperCase()) {
		let ch = raw;
		if (ch === "O") ch = "0";
		if (ch === "I" || ch === "L") ch = "1";
		if (ALPHABET.includes(ch)) out += ch;
	}
	return out;
}

export function formatPairCode(normalized: string): string {
	const code = normalizePairCode(normalized);
	if (code.length !== 8) return code;
	return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function pairCodeFromBytes(bytes: Uint8Array): string {
	let out = "";
	for (let index = 0; index < 8; index += 1) {
		const value = bytes[index] ?? 0;
		out += ALPHABET[value % ALPHABET.length];
	}
	return out;
}

export function isCompletePairCode(normalized: string): boolean {
	return normalizePairCode(normalized).length === 8;
}
