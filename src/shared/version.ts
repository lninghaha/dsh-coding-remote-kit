/**
 * Version-gate rules enforced from authenticated handshake metadata before
 * business RPC. The nullable helper input remains for legacy callers only;
 * the mobile handshake validates and supplies a concrete VersionStatus.
 */

import { MIN_COMPATIBLE_DESKTOP_VERSION } from "./constants.js";

export type VersionGateVerdict = "ok" | "mobile-too-old" | "desktop-too-old";

/** Authenticated version fields, also exposed by `status.get` for diagnostics. */
export interface VersionStatus {
	readonly protocolVersion: number;
	readonly minCompatibleMobileVersion: number;
}

/** The mobile page is too old for this desktop (desktop sets the floor). */
export function isMobileTooOld(mobileProtocolVersion: number, minCompatibleMobileVersion: number): boolean {
	return mobileProtocolVersion < minCompatibleMobileVersion;
}

/** The desktop is too old for this mobile page. */
export function isDesktopTooOld(desktopProtocolVersion: number, minDesktop = MIN_COMPATIBLE_DESKTOP_VERSION): boolean {
	return desktopProtocolVersion < minDesktop;
}

/**
 * Resolve the gate. Null retains legacy helper behavior (`ok`); the current
 * mobile entrypoint never supplies null. Check mobile then desktop floors.
 */
export function evaluateVersionGate(mobileProtocolVersion: number, status: VersionStatus | null): VersionGateVerdict {
	if (status === null) return "ok";
	if (isMobileTooOld(mobileProtocolVersion, status.minCompatibleMobileVersion)) return "mobile-too-old";
	if (isDesktopTooOld(status.protocolVersion)) return "desktop-too-old";
	return "ok";
}
