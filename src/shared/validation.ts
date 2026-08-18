/**
 * Exact-key validation for the frozen handshake messages. Every protocol
 * message rejects unknown keys so a peer cannot smuggle extensions that the
 * other end would ignore.
 */

export class ProtocolValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProtocolValidationError";
	}
}

/** Throw unless `value` is a non-null object whose keys equal `expectedKeys`. */
export function assertExactKeys(value: unknown, expectedKeys: readonly string[]): asserts value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new ProtocolValidationError("expected an object");
	}
	const actual = Object.keys(value).sort();
	const expected = [...expectedKeys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
		throw new ProtocolValidationError(
			`unexpected keys: got [${actual.join(", ")}], want [${expected.join(", ")}]`,
		);
	}
}

/** Throw unless `value` is a non-empty string. */
export function assertString(value: unknown, field: string): asserts value is string {
	if (typeof value !== "string" || value.length === 0) {
		throw new ProtocolValidationError(`${field} must be a non-empty string`);
	}
}

/** Throw unless `value` is a finite non-negative integer. */
export function assertInteger(value: unknown, field: string): asserts value is number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new ProtocolValidationError(`${field} must be a non-negative integer`);
	}
}

/** Constant-time equality of two equal-length byte strings. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
	return diff === 0;
}
