# ADR: Device key rotation / revocation（#18）

**Status:** Accepted — **ADR-only this release** (no new rotation UX or protocol)  
**Date:** 2026-09-02  
**Parent:** #11 / #18  
**Related:** `docs/04-threat-model.md`, PIN one-shot claim, settings revoke API

## Assets in scope

| Asset | Today | Notes |
| --- | --- | --- |
| `deviceToken` | Long-lived phone secret; server stores **SHA-256 only** | Must not weaken hashing or log plaintext |
| Device X25519 (phone) | Generated on phone; used in `e2ee_hello` | Ephemeral per handshake transcript, not a stored “device identity key” on server |
| Server X25519 identity | File-backed keypair (`keys.ts`), 0600 | Rotating it breaks all clients until re-pair |
| E2EE session keys | HKDF from ECDH + nonces + transcript | Per-connection; destroyed with the socket |

“Device key rotation” in this issue means **trust material that lets a phone re-authenticate** (primarily `deviceToken` / registry row), not mid-session AEAD key ratchet.

## Current controls (already shipped)

1. **PIN claim is one-shot** — offer consumed on successful claim; replay of the same PIN/offer fails.
2. **Settings revoke** — `POST /api/mobile-remote/revoke` marks `revokedAt`; later `e2ee_auth` with that token hash fails closed (`auth_failed` / revoked).
3. **Idle auto-revoke** — devices idle beyond the configured window are revoked on touch/auth paths.
4. **Token hashing** — registry compares SHA-256 digests with constant-time hex equality; plaintext token never persisted server-side.

## Threat model (rotation / revocation)

| Trigger | Attacker / event | Desired control | v0 reality |
| --- | --- | --- | --- |
| Phone lost / stolen | Holder of paired phone + `deviceToken` | Operator revokes from desktop; phone must re-pair | **Supported** via settings Unpair |
| QR / offer leak before claim | Photo of pairing QR / PIN window | Short TTL + one-shot claim | **Supported** |
| QR leak after pair | N/A (offer already consumed) | Revoke deviceToken | **Supported** |
| Suspected token exfil (XSS / shared tablet) | Malware read `sessionStorage` offer/token | Revoke + re-pair; optional scheduled rotation | **Revoke yes; scheduled rotation no** |
| Server identity key compromise | Disk reader of server secret key | Generate new server keypair; **all** devices re-pair | Manual file replace + re-pair only |
| Want periodic hygiene | No incident | Rotate `deviceToken` without full QR ceremony | **Not implemented** |

### Must not weaken

- Server continues to store **only** `deviceToken` hashes.
- Revoke/rotate must not mint a new token without an authenticated desktop (or equivalent owner) action.
- E2EE session keys stay derived from the handshake; rotation of long-term trust must not inject plaintext RPC on an unauthenticated socket.
- Do not “fix” revoke by only deleting UI state while leaving the hash row active.

## Options for stronger rotation

| Path | Description | Cost |
| --- | --- | --- |
| **M0 (now)** | Document + keep revoke / idle / one-shot PIN | Zero protocol change |
| **M1 minimal** | “Rotate token” on desktop: revoke old hash, mint new pending offer bound to same `deviceId` label, force phone re-scan | UX + registry migration test; still a re-pair |
| **M2** | In-band rotate over an already-authed E2EE session (deliver new token sealed) | New RPC, audit events, crash-window dual-hash accept list |
| **M3** | Server identity rotation with grace dual-key | Rare; operational runbook + dual verify |

## Decision (this release)

**Won’t do now:** M1–M3 implementation, in-band token rotate, or automatic server-key rotation.

**Minimal path operators should use today:**

1. Desktop → paired devices → **Unpair / revoke**.
2. Create a fresh pairing offer (QR or PIN).
3. Phone completes claim again.

Residual risk accepted until a concrete incident or product push for M1: a still-valid stolen phone retains access until the operator revokes or idle expiry fires; there is no silent background rotation of `deviceToken`.

## Revisit triggers

- Documented incident where revoke UX was too slow or undiscoverable.
- Push-bridge / multi-device product needs non-disruptive credential refresh.
- Compliance review demands bounded token lifetime independent of idle expiry.

## Non-goals

- Do not weaken deviceToken hashing or E2EE session derivation as part of “rotation”.
- Do not add cloud-side remote wipe outside the desktop owner management plane.
