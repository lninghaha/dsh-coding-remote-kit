# Changelog

All notable changes to `dsh-coding-remote-kit` are documented here, following the release loop in `docs/00-project-rules.md`. Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versioning follows [SemVer](https://semver.org/).

## Unreleased

## v0.7.1 - 2026-09-12

- 修复多设备历史游标停留在首次快照的问题；订阅确认后读取历史，并合并加载期间的实时事件。
- 手机完整展示计划审批正文；不完整的计划禁止提交，提示转到桌面处理。
- 手机断线超出宽限期只退出手机应答，保留桌面审批与问题等待；区分宿主故障和无人应答。
- 保留现有配对、凭据和 RPC 格式；无需数据迁移。回退使用上一版本包，不删除用户存储。

### Fixed

- Windows 发布检查正确解析 pnpm CLI；维护者发布脚本按稳定版或预发布版本选择 npm dist-tag，并在发布后核对 registry。

## v0.7.0 - 2026-09-12

### Added

- DSH `0.1.5-rc.2` session backend: the plugin now drives the host `sessionController` service — session list, cold `page` history, prompt, cancel, create, `follow` live events and assistant streaming frames — while the legacy `apiProxy` backend keeps `0.1.1-rc.2` working. The backend is picked per connection from capability detection; both share the same mobile protocol and RPC allowlist.
- Phone approvals and user questions on the new host: the plugin answers the `approval/request` and `user-questions/request` waterfalls itself (prepended registration so a forwarded desktop answerer cannot claim the ask first), races the phone against the composed chain, replays still-pending cards after a reconnect, and settles an abandoned ask 30 s after the last phone subscriber leaves.
- Live session-list state on the new host: `api-session/added|removed|status|error` mirror into the existing `host.event` pushes.
- Compatibility diagnostics report `sessionController` next to `apiProxy`; `healthy` no longer requires the legacy service, and the settings panel names whichever backend is active.

### Changed

- History on the new host reads a cold page through the persisted cursor (`inspect`), so opening a session does not activate an agent; the live feed starts on subscribe and a per-session delivered-sequence watermark keeps a phone that already pulled history from replaying the opening window.
- The mobile transcript folds an `assistant/message` that settles a live stream into the streamed bubble instead of appending a second copy of the reply.
- The mobile draft/approval recovery paths keep their existing behaviour across both backends; approval cards now also replay to a reconnecting phone.

### Verified

- Runtime E2E against a real DSH `0.1.5-rc.2` host (Windows, isolated profile, single plugin and Hub + Subscription co-install): compatibility reports `sessionController: available` and `status: healthy`; E2EE pairing; session list and real history; prompt answered by OpenCode Go; assistant streaming; an approval card decided on the phone with the host recording `allowed-once` and the escalated tool call really executing; an abandoned approval settling to `cancelled`; co-install keeping exactly one account entry and one remote entry.
- Native OpenCode Go calls on the new host fail with `400 MissingSessionID` without `x-opencode-session`; Hub/Subscription inject the header per DSH session through `llm/stream` (verified live), and a static provider `headers` entry remains a documented fallback for standalone installs.

### Documentation

- `compatibility/dsh-bom.json` records `dsh-0.1.5-rc.2` as a runtime-verified candidate with `sessionBackend: sessionController`; the exact build pin stays on the `0.1.1-rc.2` platform contract.
- `INSTALL.md` and the README set (9 locales) document the dual-host support, the `0.6.0 → 0.7.0` upgrade path, and the unchanged restart-by-operator rule.

## v0.6.0 - 2026-09-10

### Added

- Optional offline push bridge (ntfy / Bark): Settings configure endpoint (default **off**); on `approval.requested` send a redacted alert (event type + short session id) with a deep link into `/m/?focus=approval&sessionId=…&approvalId=…`. Outbound HTTPS host allowlist + 2 KiB body cap; missing config / no paired device → silent no-op (`#14`).
- Mobile composer **Queue / Steer** mode toggle; `session.prompt` `mode` matches the selection (`#15`).
- Mobile session **activity/status strip** for in-flight tools (and running generation) with zh-CN + en copy (`#15`).
- Mobile `session.history` **cursor paging** (`beforeSeq` / `maxMessages`): “Load earlier messages” prepends older events without clearing the composer draft (`#15`).
- Record DeepSeek Harness `0.1.5-rc.1` as an unverified BOM candidate (verified pin remains `0.1.1-rc.2`).

### Documentation

- Mark `#15` activity strip + history cursor UI as landed in research peer-capabilities notes.
- Note `0.1.5-rc.1` alongside `0.1.2-alpha` as an unverified host candidate in install/architecture/ADR docs.
- Expand `docs/06-dsh-alpha-smoke.md` and README install blurbs so candidate (`0.1.5-rc.1`) smoke rules are explicit and not confused with the verified pin.

## v0.5.2 - 2026-09-02

### Added

- Serve `/m` (data plane and rendezvous Worker assets) with a Content-Security-Policy (`script-src 'self'`, `frame-ancestors 'none'`) plus `X-Frame-Options: DENY`. This bounds post-load injection; it does not close the first-download LAN MITM gap in `docs/04-threat-model.md`.
- Pairing PIN claim is now one-shot: `claimByPairCode` drops the PIN map entry while keeping the offer token until E2EE auth consumes it.
- WebSocket authentication failures are rate-limited per remote address (`WS_AUTH_FAILURE_LIMIT` / `WS_AUTH_FAILURE_WINDOW_MS`).
- Idle paired devices expire after `DEVICE_IDLE_TTL_MS` (30 days) and are auto-revoked on auth/touch.
- Engineering baseline: `.nvmrc`, Biome lint, `assert:node`, `release:inspect` / `release:pack`.

### Changed

- Verify DeepSeek Harness `0.1.1-rc.2` as the exact BOM (peers, `compatibility/dsh-bom.json`, `DSH_VERSION`). Record `0.1.2-alpha.4` as an unverified candidate. `status.get` now reports the same pin as the BOM (it previously claimed `0.1.0-rc.7` while the BOM said `0.1.0-rc.6`).
- Stamp the mobile service worker cache name with the package version so each release invalidates a stale `/m/app.js` shell.
- Mobile X25519 secret and resume offer move from `localStorage` to `sessionStorage` (tab-scoped). Documented residual XSS/resume trade-off in the threat model.

### Documentation

- Sync `INSTALL.md` and all README translations with 0.5.x ops: upgrade bullets for `0.5.2`, disclaimer gate, connection diagnostics, and `device.name` on the RPC allowlist. Mark landed P0 rows in `docs/research/peer-capabilities-2026-08.md`.
- Align ADR `docs/01-mvp-scope.md` and architecture docs with the `0.1.1-rc.2` pin; document CSP as a post-load bound, not a MITM fix.

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
