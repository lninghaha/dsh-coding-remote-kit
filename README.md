<!-- banner -->
<div align="center">

# dsh-coding-remote-kit

**v0.5.1** · DeepSeek Harness `0.1.0-rc.6` · GitHub `dsh-coding-remote-kit`

**Remote phone access for [DeepSeek Harness](https://github.com/deepseek-ai/dsh).** Pair a phone to the desktop that already runs `dsh web`, then observe sessions and perform a narrow set of writes — without exposing the full Web API.

[![npm](https://img.shields.io/npm/v/dsh-coding-remote-kit.svg)](https://www.npmjs.com/package/dsh-coding-remote-kit)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

*[English](README.md) · [中文版](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Português (BR)](README.pt-BR.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)*

</div>

---

> **Upgrade / 升级：** Follow the versioned steps in [`INSTALL.md`](INSTALL.md). `0.5.1` fixes install→start without reloading `dsh-web` after Settings installs cloudflared; `0.5.0` added connection diagnostics, Quick Tunnel disclaimer gating, and pinned cloudflared verify; keep profile/storage/pairing files and restart one existing DSH Web process only after all selected plugins are updated. `dsh-coding-oauth-core@0.1.0` remains the Hub/Subscription shared npm dependency, not a separate DSH plugin.

---

Community plugin. **Not affiliated with, and not endorsed by, DeepSeek.** Product intent is closer to [Orca Mobile Companion](https://www.onorca.dev/docs/mobile) than to a second copy of the desktop IDE.

Read [`AGENTS.md`](AGENTS.md) before changing this repo: **do not restart the production DSH Web process or its local service wrapper yourself.** Prepare the tarball; the operator restarts it through the machine's own process manager.

## Names

Developed first as GitHub `dsh-mobile-remote`. The npm name **`dsh-mobile-remote` is a different project** (a WeChat remote-control plugin). This plugin publishes as `dsh-coding-remote-kit`.

| | Use this | Notes |
|---|---|---|
| npm | `dsh-coding-remote-kit@0.5.1` | `dsh plugin --profile web add dsh-coding-remote-kit@0.5.1` |
| GitHub | [`lninghaha/dsh-coding-remote-kit`](https://github.com/lninghaha/dsh-coding-remote-kit) | previous checkout name `dsh-mobile-remote` |
| Cordis plugin id | `mobile-remote` | unchanged |
| Settings HTTP | `/api/mobile-remote/*` | unchanged |
| Storage | `$DSH_HOME/storages/mobile-remote/` | unchanged |

Do **not** `dsh plugin add dsh-mobile-remote` — that installs the unrelated WeChat plugin.

## Status

| Milestone | Status |
| --- | --- |
| Research (Orca / DSH ecosystem) | done — [`docs/research/`](docs/research/) |
| M1 plugin skeleton + ADR / threat model | done |
| M2 pairing / LAN data plane | done |
| M3 narrow RPC / approvals | done |
| M4 signed HTTPS / native app | not started |
| M5 self-hosted rendezvous Worker | done — [`docs/05-cloud-relay.md`](docs/05-cloud-relay.md) |

## Features

- **Bilingual UI** — Chinese and English for desktop Settings and the phone companion (`?lang=` / in-app switch; defaults from `navigator.language`).
- **Pair once** — desktop shows a QR code or 8-digit PIN; the phone pins the desktop X25519 public key and holds a `deviceToken` (server stores SHA-256 only).
- **Dual plane** — management routes stay on loopback `dsh web`; the mobile data plane is a dedicated port (default `6879`) with an RPC allowlist.
- **E2EE after handshake** — tweetnacl secretbox on `/m/ws`; unauthenticated sockets never see session content.
- **Narrow writes** — observe sessions, answer approvals/questions, short replies; heavy editing stays on the desktop.
- **Private-network first** — LAN / Tailscale preferred. Optional Cloudflare Quick Tunnel exposes **only** the data plane, never port `3080`. Optional self-hosted rendezvous Worker: desktop and phone both outbound; business frames stay E2EE.
- **Standard plugin shape** — one Cordis server plugin + classic-script Settings page. `dsh plugin --profile web add` a **file tarball**, never a `link:` working tree.

## Screenshots

<p align="center">
  <img src="docs/assets/en/settings-pairing.png" alt="Desktop settings — pairing offer with QR and PIN" width="48%" />
  &nbsp;
  <img src="docs/assets/en/settings-overview.png" alt="Desktop settings — channel status and paired devices" width="48%" />
</p>
<p align="center"><em>Desktop Settings → Mobile Remote: create a pairing offer (left) · channel status &amp; devices (right)</em></p>

<p align="center">
  <img src="docs/assets/en/mobile-pair.png" alt="Phone pairing screen" width="28%" />
  &nbsp;&nbsp;
  <img src="docs/assets/en/mobile-sessions.png" alt="Phone session list" width="28%" />
</p>
<p align="center"><em>Phone companion: enter PIN / scan (left) · session list after pairing (right)</em></p>

## Problems this plugin solves

| You searched / saw | What was actually broken | What this plugin does |
|---|---|---|
| “Orca-style phone companion for DSH” | Official DSH has no first-class paired mobile app | Semantic companion: pair + E2EE + allowlisted RPC |
| `dsh-pocket` / `dsh-web-remote` on a phone | Full `dsh web` surface on LAN/public | Dual plane; unknown RPC methods are `forbidden` |
| Phone on cellular, desktop on LAN | Raw LAN HTTP page can be MITM’d | Prefer Tailscale; optional Quick Tunnel (TLS at the edge, localhost origin) |
| Plugin `import` failed and port 3080 died | DSH fail-fasts the whole plugin tree | Sandbox gate + packed tarball copied *outside* the repo; no `link:` |

## Quick start

```bash
dsh plugin --profile web add dsh-coding-remote-kit@0.5.1
```

Then the **operator** restarts the existing `dsh web` process in their own window. Open **Settings → Mobile Remote**, create a pairing offer, scan the QR (or type the PIN) on the phone.

From a source checkout (development):

```bash
pnpm test:sandbox
pnpm pack
mkdir -p "$HOME/.dsh/packages"
cp dsh-coding-remote-kit-0.5.1.tgz "$HOME/.dsh/packages/"
dsh plugin --profile web add "$HOME/.dsh/packages/dsh-coding-remote-kit-0.5.1.tgz"
```

Do not `dsh plugin add ./` from this working tree. pnpm 11 treats some `file:` tarball paths as `link:` source, and a bad entry import takes down the whole GUI.

## Table of contents

- [Names](#names)
- [Status](#status)
- [Features](#features)
- [Screenshots](#screenshots)
- [Problems this plugin solves](#problems-this-plugin-solves)
- [Quick start](#quick-start)
- [Install](#install)
- [How it works](#how-it-works)
- [Settings page](#settings-page)
- [Mobile RPC](#mobile-rpc)
- [Public tunnel](#public-tunnel)
- [Security](#security)
- [Architecture](#architecture)
- [Documentation](#documentation)
- [Related](#related)
- [Contributing](#contributing)
- [License](#license)

## Install

Requires DeepSeek Harness `0.1.0-rc.6` (pinned) and Node.js 22.19+. Full steps, pairing, and tunnel notes: [INSTALL.md](INSTALL.md).

Development:

```bash
pnpm install && pnpm build && pnpm test   # inside the Docker sandbox, not on a live GUI host
pnpm test:sandbox                         # Dockerfile targets check / isolated-install / verify
```

Build outputs:

- `lib/server/index.js` — Cordis entry (`name` / `inject` / `Config` / `apply`)
- `lib/client.js` — Settings classic-script
- `lib/mobile/` — phone page served at `/m`

## How it works

```text
Settings (loopback)          Phone browser
        │                            │
        │  QR / PIN  ────────────────┤
        ▼                            ▼
 /api/mobile-remote/*          GET /m  +  WS /m/ws
   (dsh web, :3080)            (data plane, :6879, E2EE)
```

Management stays behind the host Web loopback fence. The data plane is a separate `node:http` + `ws` server. Pairing may rebind it from `127.0.0.1` to `0.0.0.0` so LAN clients can connect; an active Quick Tunnel advertises its HTTPS origin instead of widening.

## Settings page

Open **Settings → Mobile Remote**:

- status (bind, port, listening, active devices, tunnel, rendezvous)
- **LAN** / **Quick Tunnel** / **rendezvous** channels
- create offer → QR + 8-digit PIN
- device list and revoke
- optional official `cloudflared` install (never runs at plugin `apply()`)
- connection diagnostics (sanitized network candidates, cloudflared pin/verify, disclaimer version)
- Quick Tunnel disclaimer checkbox (required before Start)

## Mobile RPC

Allowlisted methods (everything else is `forbidden`):

`status.get` · `session.list` · `session.history` · `session.subscribe` · `session.unsubscribe` · `host.subscribe` · `session.prompt` · `session.cancel` · `session.create` · `respond` · `device.name`

Pushes include session events plus `approval.requested` / `question.requested` (with `rpcId` for `respond`). Wire format: [docs/03-protocol.md](docs/03-protocol.md).

## Public tunnel

Default **off**. Start from Settings only after accepting the disclaimer (`disclaimerAccepted: true`). `cloudflared` Quick Tunnel points **only** at `127.0.0.1:<data-plane-port>`. `/m` becomes reachable on a `https://<random>.trycloudflare.com` URL; pairing still needs the fragment token (or PIN) and E2EE. The child process is killed on plugin unload / Stop.

Never tunnel port `3080` / `dsh web`. A self-hosted rendezvous Worker (desktop and phone both outbound, business frames still E2EE) is optional; see [docs/05-cloud-relay.md](docs/05-cloud-relay.md). It needs a Cloudflare Workers Paid plan and is **not** a public relay operated by this project.

## Security

Invariants (full model: [docs/04-threat-model.md](docs/04-threat-model.md)):

1. Unauthenticated connections handle handshake only.
2. `deviceToken` is stored as SHA-256; keys and registry files are `0600`.
3. RPC allowlist, default deny; writes are audited to `deviceId`.
4. Management plane is loopback + Host + CSRF.
5. The plugin does not weaken `dsh web` `/api` and does not take over `api-proxy` providers.

**Honest v0 boundary:** the first HTTP download of `/m` on a raw LAN can be MITM’d. Prefer an overlay VPN.

Prohibitions:

- Do not share another person's credentials.
- Do not monitor accounts you are not authorized to access.
- Do not bind the data-plane port on `0.0.0.0` to the public Internet (Quick Tunnel is an explicit, user-started exception).
- Do not imply DeepSeek official endorsement.

Examples in docs use `example.com`, `127.0.0.1`, and `YOUR_TOKEN` only.

## Architecture

Dual plane, module map, storage, and handshake: [docs/02-architecture.md](docs/02-architecture.md) · [中文](docs/02-architecture.zh-CN.md).

MVP decision (route B): [docs/01-mvp-scope.md](docs/01-mvp-scope.md).

## Documentation

| Doc | Purpose |
|---|---|
| [INSTALL.md](INSTALL.md) | Install, pair, tunnel |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [docs/00-project-rules.md](docs/00-project-rules.md) | Versioning, publish vs local-only, host DSH boundary |
| [docs/01-mvp-scope.md](docs/01-mvp-scope.md) | ADR: MVP scope (Chinese) |
| [docs/02-architecture.md](docs/02-architecture.md) | Internal architecture · [中文](docs/02-architecture.zh-CN.md) |
| [docs/03-protocol.md](docs/03-protocol.md) | RPC allowlist and push envelopes (Chinese) |
| [docs/04-threat-model.md](docs/04-threat-model.md) | Assets, attackers, invariants (Chinese) |
| [docs/05-cloud-relay.md](docs/05-cloud-relay.md) | Self-hosted rendezvous Worker (M5) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guide |
| [AGENTS.md](AGENTS.md) | Agent/operator rules (no production restart) |

## Related

- [dsh-coding-subscription-oauth](https://github.com/lninghaha/dsh-coding-subscription-oauth) — sibling plugin; documentation layout is modelled on it.
- GitHub: [`lninghaha/dsh-coding-remote-kit`](https://github.com/lninghaha/dsh-coding-remote-kit).
- This plugin is independent of the usage-centre plugin `dsh-hub-oauth-gateway`.
- It does not replace `@deepseek-ai/dsh`.

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the Docker sandbox, commit conventions, and the document layers.

## License

[MIT](LICENSE).
