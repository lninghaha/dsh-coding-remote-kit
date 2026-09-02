# ADR: tweetnacl → libsodium / WebCrypto（#16）

**Status:** Accepted — **defer replacement** for the current pairing/E2EE milestone  
**Date:** 2026-09-02  
**Parent:** #11 / #16

## Context

Mobile data-plane crypto today uses `tweetnacl` for:

- X25519 `box.keyPair` / ECDH (`nacl.box.before` / shared secret)
- XSalsa20-Poly1305 `secretbox` sealed frames (`src/shared/frame.ts`)

Server Cordis entry **must** keep `tweetnacl` as an esbuild `external` (bundling it into ESM triggers `Dynamic require of "crypto" is not supported`). That invariant is gated by `tests/bundle-externals.test.js` and must not be removed.

HKDF-SHA256 is already split: Node `hkdfSync` on the server (`src/server/crypto.ts`) and pure-JS on the mobile page (`src/shared/hkdf.ts`), with cross-end vectors in tests.

## Options

| Option | What it gives | Gaps / cost |
| --- | --- | --- |
| **A. Keep `tweetnacl` (status quo)** | Stable NaCl box/secretbox API; tiny pure-JS; works in mobile classic script without WASM; known external-package story | Unmaintained upstream; no WebCrypto audit story; residual supply-chain / “legacy crypto lib” perception |
| **B. `libsodium-wrappers` (or `libsodium-wrappers-sumo`)** | NaCl-compatible `crypto_box` / `crypto_secretbox`; active maintenance; optional WASM | Larger mobile download; WASM/init async path; still must stay **external** on server ESM (same CJS/`crypto` risk class); dual pure-JS fallback complexity |
| **C. WebCrypto only** | Platform crypto; no tweetnacl dep | **No XSalsa20-Poly1305 secretbox** in WebCrypto. X25519 ECDH exists in modern Chromium / recent Node, but **not** a drop-in for our sealed-frame layout. Replacing secretbox means a **wire break** (new AEAD, nonce/header rules, version bump) |

## Compatibility note (explicit)

Any move away from `nacl.secretbox` without a dual-stack negotiation is a **breaking protocol change**: already-paired phones and in-flight sessions cannot decrypt new frames. A replacement therefore needs either:

1. a new E2EE version flag + dual decrypt for one release, **or**
2. forced re-pair of every device (product-visible break).

There is **no** silent “swap the npm package” path that preserves on-wire secretbox bytes.

## Decision

**Defer.** Stay on `tweetnacl` for X25519 + secretbox until a planned E2EE version bump can carry a new AEAD (or a proven NaCl-compatible library swap with byte-identical vectors).

Do **not** adopt WebCrypto as a full replacement in this cadence: it cannot implement the current sealed-frame primitive.

`libsodium-wrappers` is the only realistic *compatible* successor if we later want maintenance without redesigning frames; it is still **not** worth the mobile/WASM and bundle-external churn while pairing hardening and push/tunnel work are higher priority.

## Residual risk

- Dependence on an unmaintained pure-JS NaCl port.
- Perception / audit friction vs WebCrypto or libsodium.
- Continued need to keep tweetnacl out of the server ESM bundle (operational footgun if someone “helps” by bundling deps).

None of these are active exploit paths unique to tweetnacl vs libsodium for our threat model (LAN MITM of first `/m` delivery remains the dominant client integrity gap; see `docs/04-threat-model.md`).

## Revisit triggers

Re-open this ADR when **any** of the following is true:

1. Shipping a deliberate E2EE v2 (new AEAD / frame layout) anyway.
2. Mobile bundle size or CSP/WASM policy makes a audited WASM sodium preferable.
3. A concrete CVE or supply-chain incident in `tweetnacl` / its publish pipeline.
4. Target browsers drop or block the current classic-script crypto path.

## Non-goals (this release)

- No dependency bump, PoC branch merge, or dual-stack handshake.
- No weakening of `packages: "external"` / bundle-externals assertions.
