/**
 * Normalize a user-facing device name without inventing a protocol length cap.
 * Empty names mean "unnamed"; control/format characters are rejected because
 * they can make audit and settings UI misleading.
 */
export type DeviceNameResult =
	| { readonly ok: true; readonly value?: string }
	| { readonly ok: false; readonly reason: "control-characters" };

export function normalizeDeviceName(value: unknown): DeviceNameResult {
	if (typeof value !== "string") return { ok: true };
	const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
	if (normalized.length === 0) return { ok: true };
	if (/[\p{Cc}\p{Cf}]/u.test(normalized)) return { ok: false, reason: "control-characters" };
	return { ok: true, value: normalized };
}
