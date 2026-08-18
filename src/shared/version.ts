/**
 * Version-gate rules enforced by the mobile page after `status.get`.
 *
 * The mobile page must make `status.get` its first authenticated call, then
 * hard-block on either direction being too old. A failed `status.get` fails
 * open (does not block) so a transient transport error never bricks pairing.
 */

import { MIN_COMPATIBLE_DESKTOP_VERSION } from "./constants.js";

export type VersionGateVerdict = "ok" | "mobile-too-old" | "desktop-too-old";

/** The fields of `status.get` result that participate in the gate. */
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
 * Resolve the gate. `status === null` means `status.get` failed, which fails
 * open (`ok`). Otherwise the mobile floor and desktop floor are checked in
 * that order.
 */
export function evaluateVersionGate(mobileProtocolVersion: number, status: VersionStatus | null): VersionGateVerdict {
	if (status === null) return "ok";
	if (isMobileTooOld(mobileProtocolVersion, status.minCompatibleMobileVersion)) return "mobile-too-old";
	if (isDesktopTooOld(status.protocolVersion)) return "desktop-too-old";
	return "ok";
}
