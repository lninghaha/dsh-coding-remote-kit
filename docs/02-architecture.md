# Architecture

> [**中文版**](02-architecture.zh-CN.md) · English

This document describes the internal architecture of `dsh-coding-remote-kit`. It is the source for the technical notes in `README.md` and is intended for contributors and maintainers.

Host pin: `@deepseek-ai/dsh@0.1.0-rc.7`. Changing the pin requires a new ADR (`docs/01-mvp-scope.md`).

## 1. Dual plane

```text
Harness webServer (loopback, typically 127.0.0.1:3080)
  └─ management routes /api/mobile-remote/*
       pairing offers, device list, revoke, tunnel switch
       Host + browser-context + CSRF guards; non-loopback → 403

Dedicated data plane (default 127.0.0.1:6879, may widen to 0.0.0.0)
  ├─ GET  /m, /m/*     static mobile page (cache-control: no-store)
  ├─ POST /m/claim     pairing PIN → offer (rate-limited)
  └─ WS   /m/ws        E2EE handshake + allowlisted RPC
```

The plugin does **not** reverse-proxy `dsh web` and does **not** steal the host `api-proxy` approval/question provider. Session observation and writes go through a narrow RPC allowlist on the data plane.

MVP route: **B — semantic narrow RPC + dual plane** (`docs/01-mvp-scope.md`). Route A (full Web passthrough) was rejected. Route C (signed native app) is deferred.

## 2. Host data flow

```text
Settings (src/client)
  └─ slots.register "移动远程"
       GET  /api/mobile-remote/status
       POST /api/mobile-remote/offers     → widen or advertise tunnel + QR / PIN
       GET  /api/mobile-remote/devices
       POST /api/mobile-remote/revoke
       GET/POST /api/mobile-remote/tunnel
       POST /api/mobile-remote/cloudflared

Phone browser /m (src/mobile)
  └─ location.hash fragment (pairing offer) or POST /m/claim { code }
       └─ X25519 device key (generated on phone)
            └─ WebSocket /m/ws
                 e2ee_hello → transcript → session keys (secretbox)
                      └─ status.get → session.list / subscribe / respond / prompt

src/server
  ├─ DeviceRegistry     devices.json (token SHA-256 only)
  ├─ OfferRegistry      in-memory pending offers
  ├─ AuditLogger        audit.jsonl (method + ids, no payloads)
  ├─ server-key.json    X25519 identity (0600)
  ├─ MobileDataPlane    HTTP + ws
  ├─ CloudflareQuickTunnel   data plane only (never port 3080)
  └─ UpstreamHub        apiProxy sessions / approvals / questions
```

Unauthenticated WebSocket connections handle **handshake only**. Business RPC starts after `e2ee_auth`.

## 3. Module responsibilities

### `src/index.ts`

Re-exports Cordis `name` / `inject` / `Config` / `apply` from `src/server/index.ts`.

### `src/server/`

- `index.ts`: plugin `apply`. Storage, server key, data-plane listen, management routes, tunnel disposer.
- `config.ts`: Zod `enabled` / `bind` / `port` / `offerTtlMs` / `trustedHosts`.
- `context.ts`: host `apiProxy` + `webServer` typing.
- `routes.ts`: one `webServer.register` per path (DSH de-duplicates by path, not method). GET/POST branch inside the handler.
- `security.ts`: loopback / Host / browser context / CSRF / bounded JSON body.
- `dataplane.ts`: dedicated `node:http` + `ws` on the data-plane port; static `/m`; `/m/claim`; `/m/ws`.
- `e2ee.ts` / `crypto.ts`: server handshake, token lookup, tweetnacl secretbox.
- `rpc.ts`: allowlist dispatch; unknown methods → `forbidden`.
- `upstream.ts`: host `apiProxy` session/approval/question bridge.
- `registry.ts`: devices + in-memory offers + JSONL audit.
- `keys.ts` / `storage.ts`: `$DSH_HOME/storages/mobile-remote/` (dir 0700, files 0600, atomic write).
- `net.ts`: LAN candidate addresses for QR advertise.
- `backpressure.ts`: per-connection outbound queue limits.
- `tunnel.ts`: Cloudflare Quick Tunnel child process; persist `tunnel.json`; kill on unload.
- `cloudflared-install.ts`: opt-in official binary install (never at `apply()`).

### `src/shared/`

Dependency-free protocol constants and codecs used by both Node and the mobile page: `constants.ts` (RPC allowlist, frame sizes, HKDF labels), `offer.ts`, `pair-code.ts`, `handshake.ts`, `frame.ts`, `hkdf.ts`, `transcript.ts`, `validation.ts`, `base64.ts`, `version.ts`.

### `src/client/`

Classic-script Settings page (`window.__ModuleLoader__.load`). QR, 8-digit PIN, device list, LAN vs public channel, tunnel start/stop. Injects `@deepseek-ai/dsh-client-ui-settings` + `dsh-client-ui-slots`.

### `src/mobile/`

Phone browser page, built to `lib/mobile/`. `main.ts` reads the fragment offer, keeps one WebSocket, runs the four-step handshake. `app.ts` renders session list / transcript / short reply / approval and question cards. `sw.js` caches only the `/m` static shell.

## 4. HTTP / WebSocket API

Management plane (host `webServer`, loopback-only):

```text
POST /api/mobile-remote/offers
GET  /api/mobile-remote/status
GET  /api/mobile-remote/devices          # never includes tokenHash
POST /api/mobile-remote/revoke           # { deviceId }
GET  /api/mobile-remote/tunnel
POST /api/mobile-remote/tunnel           # { kind: "cloudflare-quick", action: "start"|"stop" }
POST /api/mobile-remote/cloudflared      # { action: "install" }
```

JSON write bodies are bounded. Responses contain status, offer metadata, QR text, and non-secret expiry — never `deviceToken` or the server secret key.

Data plane (port 6879 by default):

```text
GET  /m  → 302 /m/
GET  /m/*                 static mobile assets, no-store
POST /m/claim             { code } → { offer }   # 8-digit PIN; 8 failures / IP / minute
WS   /m/ws                E2EE + RPC
```

RPC methods and push envelopes: `docs/03-protocol.md`.

## 5. Storage

`$DSH_HOME/storages/mobile-remote/` (`$DSH_HOME` defaults to `~/.dsh`):

| File | Role |
|---|---|
| `server-key.json` | X25519 identity; 0600; created on first boot |
| `devices.json` | paired devices; **SHA-256 of deviceToken only** |
| `audit.jsonl` | `rpc_write` / offer / revoke / tunnel events; no payloads |
| `tunnel.json` | Quick Tunnel persist so a crash can reap a stale child |

## 6. Pairing and E2EE

1. Desktop creates a pairing offer (endpoint, page URL, server public key, TTL).
2. Phone opens `/m#<offer>` (QR) or POSTs the 8-digit PIN to `/m/claim`.
3. Phone generates its own X25519 key and connects to `/m/ws`.
4. Four-step handshake (`dshmr-e2ee/v1`) pins the desktop public key, derives session keys via HKDF, then `e2ee_auth` with the device token.
5. Further frames are tweetnacl secretbox. Five consecutive decrypt failures close the socket.

Honest v0 boundary: the **first HTTP download of `/m`** on a raw LAN is MITM-able. E2EE does not protect a replaced page. Prefer Tailscale / WireGuard; optional Cloudflare Quick Tunnel terminates TLS at the edge and must never include port 3080. Details: `docs/04-threat-model.md`.

## 7. Build outputs

| Artifact | Role |
|---|---|
| `lib/server/index.js` | Bundled Cordis entry (`packages: "external"` — do not bundle `tweetnacl`) |
| `lib/client.js` | Settings classic-script |
| `lib/mobile/` | Phone page + service worker |
| `lib/**` transpiled tree | Unit-test import surface only |

`package.json` `exports` must include `"."`, `"./client"`, and `"./package.json"` (DSH scans client modules via `require.resolve("<pkg>/package.json")`).

## 8. Compatibility

- Cordis plugin id: `mobile-remote`.
- Config defaults: `enabled: true`, `bind: "127.0.0.1"`, `port: 6879`.
- Pairing widens the data plane to `0.0.0.0` when advertising LAN candidates and no public tunnel is running.
- Wire protocol version: `MOBILE_PROTOCOL_VERSION = 1` (`src/shared/constants.ts`).
