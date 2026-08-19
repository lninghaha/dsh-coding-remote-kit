<!-- banner -->
<div align="center">

# dsh-coding-remote-kit

**v0.1.0** · DeepSeek Harness `0.1.0-rc.7` · GitHub `dsh-coding-remote-kit`

**Remote phone access for [DeepSeek Harness](https://github.com/deepseek-ai/dsh).** Pair a phone to the desktop that already runs `dsh web`, then observe sessions and perform a narrow set of writes — without exposing the full Web API.

[![npm](https://img.shields.io/npm/v/dsh-coding-remote-kit.svg)](https://www.npmjs.com/package/dsh-coding-remote-kit)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

*[English](README.md) · [中文版](README.zh-CN.md)*

</div>

---

Community plugin. **Not affiliated with, and not endorsed by, DeepSeek.** Product intent is closer to [Orca Mobile Companion](https://www.onorca.dev/docs/mobile) than to a second copy of the desktop IDE.

Read [`AGENTS.md`](AGENTS.md) before changing this repo: **do not restart production `dsh-web` yourself.** Prepare the tarball; the operator restarts.

## Names

Developed first as GitHub `dsh-mobile-remote`. The npm name **`dsh-mobile-remote` is a different project** (a WeChat remote-control plugin). This plugin publishes as `dsh-coding-remote-kit`.

| | Use this | Notes |
|---|---|---|
| npm | `dsh-coding-remote-kit@0.1.0` | `dsh plugin --profile web add dsh-coding-remote-kit@0.1.0` |
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

## Features

- **Pair once** — desktop shows a QR code or 8-digit PIN; the phone pins the desktop X25519 public key and holds a `deviceToken` (server stores SHA-256 only).
- **Dual plane** — management routes stay on loopback `dsh web`; the mobile data plane is a dedicated port (default `6879`) with an RPC allowlist.
- **E2EE after handshake** — tweetnacl secretbox on `/m/ws`; unauthenticated sockets never see session content.
- **Narrow writes** — observe sessions, answer approvals/questions, short replies; heavy editing stays on the desktop.
- **Private-network first** — LAN / Tailscale preferred. Optional Cloudflare Quick Tunnel exposes **only** the data plane, never port `3080`.
- **Standard plugin shape** — one Cordis server plugin + classic-script Settings page. `dsh plugin --profile web add` a **file tarball**, never a `link:` working tree.

## Problems this plugin solves

| You searched / saw | What was actually broken | What this plugin does |
|---|---|---|
| “Orca-style phone companion for DSH” | Official DSH has no first-class paired mobile app | Semantic companion: pair + E2EE + allowlisted RPC |
| `dsh-pocket` / `dsh-web-remote` on a phone | Full `dsh web` surface on LAN/public | Dual plane; unknown RPC methods are `forbidden` |
| Phone on cellular, desktop on LAN | Raw LAN HTTP page can be MITM’d | Prefer Tailscale; optional Quick Tunnel (TLS at the edge, localhost origin) |
| Plugin `import` failed and port 3080 died | DSH fail-fasts the whole plugin tree | Sandbox gate + packed tarball copied *outside* the repo; no `link:` |

## Quick start

```bash
dsh plugin --profile web add dsh-coding-remote-kit@0.1.0
```

Then the **operator** restarts the existing `dsh web` process in their own window. Open **Settings → 移动远程**, create a pairing offer, scan the QR (or type the PIN) on the phone.

From a source checkout (development):

```bash
pnpm test:sandbox
pnpm pack
mkdir -p "$HOME/.dsh/packages"
cp dsh-coding-remote-kit-0.1.0.tgz "$HOME/.dsh/packages/"
dsh plugin --profile web add "$HOME/.dsh/packages/dsh-coding-remote-kit-0.1.0.tgz"
```

Do not `dsh plugin add ./` from this working tree. pnpm 11 treats some `file:` tarball paths as `link:` source, and a bad entry import takes down the whole GUI.

## Table of contents

- [Names](#names)
- [Status](#status)
- [Features](#features)
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

Requires DeepSeek Harness `0.1.0-rc.7` (pinned) and Node.js 22.19+. Full steps, pairing, and tunnel notes: [INSTALL.md](INSTALL.md).

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

Open **Settings → 移动远程**:

- status (bind, port, listening, active devices, tunnel)
- **LAN** vs **public** channel
- create offer → QR + 8-digit PIN
- device list and revoke
- optional official `cloudflared` install (never runs at plugin `apply()`)

## Mobile RPC

Allowlisted methods (everything else is `forbidden`):

`status.get` · `session.list` · `session.history` · `session.subscribe` · `session.unsubscribe` · `host.subscribe` · `session.prompt` · `session.cancel` · `session.create` · `respond`

Pushes include session events plus `approval.requested` / `question.requested` (with `rpcId` for `respond`). Wire format: [docs/03-protocol.md](docs/03-protocol.md).

## Public tunnel

Default **off**. When started from Settings, `cloudflared` Quick Tunnel points **only** at `127.0.0.1:<data-plane-port>`. `/m` becomes reachable on a `https://<random>.trycloudflare.com` URL; pairing still needs the fragment token (or PIN) and E2EE. The child process is killed on plugin unload / Stop.

Never tunnel port `3080` / `dsh web`. A self-hosted rendezvous relay is **not** implemented; see [docs/05-cloud-relay.md](docs/05-cloud-relay.md).

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
| [docs/05-cloud-relay.md](docs/05-cloud-relay.md) | Future rendezvous relay (not implemented) |
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
