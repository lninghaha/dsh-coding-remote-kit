# Changelog

All notable changes to `dsh-coding-remote-kit` are documented here, following the release loop in `docs/00-project-rules.md`. Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versioning follows [SemVer](https://semver.org/).

## Unreleased

## v0.5.1 - 2026-08-28

### Fixed

- Re-resolve `cloudflared` on each start and drive `binaryOk` from a live pin check, so Settings install can start Quick Tunnel without reloading `dsh-web`. Hash-mismatch recovery no longer sticks false until process restart.

## v0.5.0 - 2026-08-28

### Added

- Connection diagnostics on GET status (`connectionDiagnostics`, schemaVersion 1): sanitized network candidates, cloudflared pin/verify status, tunnel `urlHost`, disclaimer version.
- Quick Tunnel start requires per-request `disclaimerAccepted: true`; Settings checkbox gates start.
- Pin cloudflared to release `2026.8.2` with sha256 re-verify before spawn (`binary-untrusted` on mismatch).

### Security

- Refuse bare PATH and non-absolute `CLOUDFLARED` / binary paths; diagnostics redact `$HOME` prefixes.
- Pin runtime dependency `zod` to `4.4.3` so packed offline installs stay deterministic.

### Documentation

- Peer remote-plugin capability survey (`docs/research/peer-capabilities-2026-08.md`) and ecosystem comparison updates.

## v0.4.1 - 2026-08-22

### Fixed

- Probe optional DSH host services through a guarded compatibility boundary so strict Cordis injection checks cannot fail the complete plugin tree during startup.

## v0.4.0 - 2026-08-22

### Added

- Add an exact DSH compatibility BOM, host/client adapters, compatibility diagnostics, trusted remote owner policy, optional device names, and accessible pairing/session states.

### Changed

- Preserve mobile drafts, focus, scroll, and in-flight actions across pushes; keep the official mobile client on the frozen four-field v1 auth shape and apply device names after authentication for older-desktop compatibility.

### Security

- Require exact trusted-proxy peer, HTTPS origin/host, owner proof, Fetch Metadata, and mutation CSRF evidence; keep DSH loopback-only and fail closed when remote owner configuration is incomplete.

## v0.3.0 - 2026-08-19

### Added

- Bilingual product UI (zh-CN / en) for desktop Settings and the phone companion: auto-detect via `navigator.language`, optional `?lang=`, in-app switch persisted in `localStorage`.
- Shared i18n catalog under `src/shared/i18n/`; pairing API errors localize from stable `error.code` values.

### Documentation

- README screenshots split by language: `docs/assets/zh-CN/*` for `README.zh-CN.md`, `docs/assets/en/*` for all other READMEs.

## v0.2.2 - 2026-08-19

### Documentation

- Add README screenshots (`docs/assets/`): desktop Settings pairing / overview, and phone pair / sessions. Tracked in git and included in the npm package so images resolve on GitHub and npm.

## v0.2.1 - 2026-08-19

### Changed

- Desktop settings: data-plane status banner (listen state, port, LAN reach, active devices), QR white quiet zone, formatted PIN with copy buttons, expiry progress bar, inline channel errors, device online/revoked badges, and revoke confirmation.
- Mobile pairing shell: structured notice and PIN cards (replacing plain text), Crockford PIN formatting with auto-submit, retry / change-code / clear-local-pairing on failure or disconnect.
- Mobile session UI: role-labeled bubbles, block-level fenced code, stop button only while running, session info sheet, approval cards with workspace/task context, debounced search, and clearer empty states.
- Add `remote` to package.json keywords ahead of the awesome-dsh-plugin listing.

### Documentation

- README community translations aligned with `dsh-coding-subscription-oauth`: `README.ja.md`, `README.ko.md`, `README.pt-BR.md`, `README.es.md`, `README.fr.md`, `README.de.md`, `README.ru.md`. All nine README files share the same language-switch line.

## v0.2.0 - 2026-08-19

### Added

- Self-hosted rendezvous relay (M5): desktop and phone open outbound WSS to an operator-deployed Cloudflare Worker (`relay/`). Business frames stay `dshmr-e2ee/v1`. Settings gain a third channel, mutually exclusive with Quick Tunnel. PIN-over-relay is proxied to the desktop; the Worker operator can see that offer.
- Phone page persists the last pairing offer so a refresh can resume without scanning again.

### Documentation

- `docs/05-cloud-relay.md` is now the M5 spec. Threat model, architecture, protocol, README, and INSTALL updated.

## v0.1.0 - 2026-08-19

### Added

- First public release as **`dsh-coding-remote-kit`** (GitHub `lninghaha/dsh-coding-remote-kit`). The npm name `dsh-mobile-remote` is a different WeChat plugin and is not this project.
- M1 Cordis plugin skeleton (`mobile-remote`) with Settings classic-script and Docker sandbox gate.
- M2 E2EE pairing (QR + 8-digit PIN), LAN data plane on port 6879, phone page at `/m`.
- M3 allowlisted RPC (session observe, short prompt, approvals/questions) and management routes on loopback `dsh web`.
- Optional Cloudflare Quick Tunnel that exposes only the data plane (never port 3080).

### Documentation

- Numbered `docs/`, English + zh-CN READMEs, `INSTALL.md`, `CONTRIBUTING.md`, publish vs local-only split.
- Move esbuild entry scripts into `build/` and add GitHub Actions Docker CI.
- Replace machine-specific hostnames in tests and comments with `example.com` / `/tmp/example-project`.
