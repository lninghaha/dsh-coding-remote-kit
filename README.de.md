<!-- banner -->
<div align="center">

# dsh-coding-remote-kit

**v0.3.0** · DeepSeek Harness `0.1.0-rc.7` · GitHub `dsh-coding-remote-kit`

**Fernzugriff per Smartphone für [DeepSeek Harness](https://github.com/deepseek-ai/dsh).** Koppeln Sie ein Telefon mit dem Desktop, auf dem bereits `dsh web` läuft, beobachten Sie Sitzungen und führen Sie eine enge Menge von Schreibvorgängen aus — ohne die vollständige Web-API offenzulegen.

[![npm](https://img.shields.io/npm/v/dsh-coding-remote-kit.svg)](https://www.npmjs.com/package/dsh-coding-remote-kit)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

*[English](README.md) · [中文版](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Português (BR)](README.pt-BR.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)*

</div>

---

Community-Plugin. **Nicht mit DeepSeek verbunden und nicht von DeepSeek unterstützt.** Die Produktabsicht liegt näher bei [Orca Mobile Companion](https://www.onorca.dev/docs/mobile) als bei einer zweiten Kopie der Desktop-IDE.

Lesen Sie [`AGENTS.md`](AGENTS.md), bevor Sie dieses Repository ändern: **starten Sie das Produktions-`dsh-web` nicht selbst neu.** Bereiten Sie das Tarball vor; der Operator startet neu.

## Namen

Zuerst als GitHub `dsh-mobile-remote` entwickelt. Der npm-Name **`dsh-mobile-remote` ist ein anderes Projekt** (WeChat-Fernsteuerungs-Plugin). Dieses Plugin erscheint als `dsh-coding-remote-kit`.

| | Das verwenden | Hinweise |
|---|---|---|
| npm | `dsh-coding-remote-kit@0.3.0` | `dsh plugin --profile web add dsh-coding-remote-kit@0.3.0` |
| GitHub | [`lninghaha/dsh-coding-remote-kit`](https://github.com/lninghaha/dsh-coding-remote-kit) | früherer Checkout-Name `dsh-mobile-remote` |
| Cordis-Plugin-id | `mobile-remote` | unverändert |
| HTTP der Einstellungsseite | `/api/mobile-remote/*` | unverändert |
| Speicher | `$DSH_HOME/storages/mobile-remote/` | unverändert |

Führen Sie **nicht** `dsh plugin add dsh-mobile-remote` aus — das installiert das fremde WeChat-Plugin.

## Status

| Meilenstein | Status |
| --- | --- |
| Recherche (Orca / DSH-Ökosystem) | erledigt — [`docs/research/`](docs/research/) |
| M1 Plugin-Skelett + ADR / Bedrohungsmodell | erledigt |
| M2 Kopplung / LAN-Datenebene | erledigt |
| M3 enges RPC / Freigaben | erledigt |
| M4 signiertes HTTPS / native App | nicht begonnen |
| M5 selbst gehosteter Rendezvous-Worker | erledigt — [`docs/05-cloud-relay.md`](docs/05-cloud-relay.md) |

## Funktionen

- **Zweisprachige UI** — Chinesisch und Englisch für Desktop-Einstellungen und Telefon-Companion (`?lang=` / Umschalter in der App; Standard `navigator.language`).
- **Einmal koppeln** — der Desktop zeigt einen QR-Code oder eine 8-stellige PIN; das Telefon merkt sich fest den öffentlichen X25519-Schlüssel des Desktops und hält ein `deviceToken` (der Server speichert nur SHA-256).
- **Zwei Ebenen** — Verwaltungsrouten bleiben auf dem Loopback-`dsh web`; die mobile Datenebene ist ein eigener Port (Standard `6879`) mit RPC-Allowlist.
- **E2EE nach dem Handshake** — tweetnacl secretbox auf `/m/ws`; unauthentifizierte Sockets sehen niemals Sitzungsinhalt.
- **Enge Schreibvorgänge** — Sitzungen beobachten, Freigaben/Fragen beantworten, kurze Antworten; schwere Bearbeitung bleibt auf dem Desktop.
- **Privates Netz zuerst** — LAN / Tailscale bevorzugt. Optionaler Cloudflare Quick Tunnel legt **nur** die Datenebene offen, niemals Port `3080`. Optionaler selbst gehosteter Rendezvous-Worker: Desktop und Telefon beide outbound; Geschäftsframes bleiben E2EE.
- **Standard-Plugin-Form** — ein Cordis-Server-Plugin + classic-script-Einstellungsseite. `dsh plugin --profile web add` mit einem **file tarball**, niemals einem `link:`-Arbeitsbaum.

## Screenshots

<p align="center">
  <img src="docs/assets/en/settings-pairing.png" alt="Desktop-Einstellungen — Kopplungsangebot mit QR und PIN" width="48%" />
  &nbsp;
  <img src="docs/assets/en/settings-overview.png" alt="Desktop-Einstellungen — Kanalstatus und gekoppelte Geräte" width="48%" />
</p>
<p align="center"><em>Desktop Settings → Mobile Remote: Kopplungsangebot erstellen (links) · Kanalstatus &amp; Geräte (rechts)</em></p>

<p align="center">
  <img src="docs/assets/en/mobile-pair.png" alt="Telefon-Kopplungsbildschirm" width="28%" />
  &nbsp;&nbsp;
  <img src="docs/assets/en/mobile-sessions.png" alt="Telefon-Sitzungsliste" width="28%" />
</p>
<p align="center"><em>Telefon-Companion: PIN eingeben / scannen (links) · Sitzungsliste nach der Kopplung (rechts)</em></p>

## Probleme, die dieses Plugin löst

| Gesucht / gesehen | Was wirklich kaputt war | Was dieses Plugin tut |
|---|---|---|
| „Orca-artiges Telefon-Companion für DSH“ | Offizielles DSH hat keine erstklassige gekoppelte Mobile-App | Semantisches Companion: Kopplung + E2EE + Allowlist-RPC |
| `dsh-pocket` / `dsh-web-remote` auf einem Telefon | Volle `dsh-web`-Oberfläche im LAN/öffentlich | Zwei Ebenen; unbekannte RPC-Methoden sind `forbidden` |
| Telefon im Mobilfunk, Desktop im LAN | Rohe LAN-HTTP-Seite kann MITM werden | Tailscale bevorzugen; optionaler Quick Tunnel (TLS am Rand, Origin localhost) |
| Plugin-`import` fehlgeschlagen und Port 3080 tot | DSH fail-fastet den ganzen Plugin-Baum | Sandbox-Tor + Tarball *außerhalb* des Repos kopiert; kein `link:` |

## Schnellstart

```bash
dsh plugin --profile web add dsh-coding-remote-kit@0.3.0
```

Danach startet der **Operator** den bestehenden `dsh-web`-Prozess in seinem eigenen Fenster neu. Öffnen Sie **Settings → 移動远程**, erstellen Sie ein Kopplungsangebot, scannen Sie den QR (oder tippen Sie die PIN) auf dem Telefon.

Aus einem Quell-Checkout (Entwicklung):

```bash
pnpm test:sandbox
pnpm pack
mkdir -p "$HOME/.dsh/packages"
cp dsh-coding-remote-kit-0.3.0.tgz "$HOME/.dsh/packages/"
dsh plugin --profile web add "$HOME/.dsh/packages/dsh-coding-remote-kit-0.3.0.tgz"
```

Führen Sie nicht `dsh plugin add ./` aus diesem Arbeitsbaum aus. pnpm 11 behandelt manche `file:`-Tarball-Pfade als `link:`-Quelle, und ein fehlgeschlagener Entry-Import legt die ganze GUI lahm.

## Inhaltsverzeichnis

- [Namen](#namen)
- [Status](#status)
- [Funktionen](#funktionen)
- [Screenshots](#screenshots)
- [Probleme, die dieses Plugin löst](#probleme-die-dieses-plugin-löst)
- [Schnellstart](#schnellstart)
- [Installation](#installation)
- [Funktionsweise](#funktionsweise)
- [Einstellungsseite](#einstellungsseite)
- [Mobile RPC](#mobile-rpc)
- [Öffentlicher Tunnel](#öffentlicher-tunnel)
- [Sicherheit](#sicherheit)
- [Architektur](#architektur)
- [Dokumentation](#dokumentation)
- [Verwandt](#verwandt)
- [Mitwirken](#mitwirken)
- [Lizenz](#lizenz)

## Installation

Erfordert DeepSeek Harness `0.1.0-rc.7` (gepinnt) und Node.js 22.19+. Vollständige Schritte, Kopplung und Tunnel-Hinweise: [INSTALL.md](INSTALL.md).

Entwicklung:

```bash
pnpm install && pnpm build && pnpm test   # inside the Docker sandbox, not on a live GUI host
pnpm test:sandbox                         # Dockerfile targets check / isolated-install / verify
```

Build-Ausgaben:

- `lib/server/index.js` — Cordis-Einstieg (`name` / `inject` / `Config` / `apply`)
- `lib/client.js` — Einstellungs-classic-script
- `lib/mobile/` — Telefonseite unter `/m`

## Funktionsweise

```text
Settings (loopback)          Phone browser
        │                            │
        │  QR / PIN  ────────────────┤
        ▼                            ▼
 /api/mobile-remote/*          GET /m  +  WS /m/ws
   (dsh web, :3080)            (data plane, :6879, E2EE)
```

Die Verwaltung bleibt hinter dem Loopback-Zaun des Host-Web. Die Datenebene ist ein eigener `node:http` + `ws`-Server. Die Kopplung kann ihn von `127.0.0.1` auf `0.0.0.0` umbinden, damit LAN-Clients verbinden können; ein aktiver Quick Tunnel wirbt seinen HTTPS-Origin, statt den Bind zu erweitern.

## Einstellungsseite

Öffnen Sie **Settings → 移動远程**:

- Status (Bind, Port, Listening, aktive Geräte, Tunnel, Rendezvous)
- Kanäle **LAN** / **Quick Tunnel** / **rendezvous**
- Angebot erstellen → QR + 8-stellige PIN
- Geräteliste und Widerruf
- optionale offizielle `cloudflared`-Installation (läuft nie beim Plugin-`apply()`)

## Mobile RPC

Allowlist-Methoden (alles andere ist `forbidden`):

`status.get` · `session.list` · `session.history` · `session.subscribe` · `session.unsubscribe` · `host.subscribe` · `session.prompt` · `session.cancel` · `session.create` · `respond`

Pushes umfassen Sitzungsereignisse plus `approval.requested` / `question.requested` (mit `rpcId` für `respond`). Drahtformat: [docs/03-protocol.md](docs/03-protocol.md).

## Öffentlicher Tunnel

Standard **aus**. Wenn aus den Einstellungen gestartet, zeigt der `cloudflared`-Quick-Tunnel **nur** auf `127.0.0.1:<data-plane-port>`. `/m` wird unter einer `https://<random>.trycloudflare.com`-URL erreichbar; die Kopplung braucht weiterhin das Fragment-Token (oder die PIN) und E2EE. Der Kindprozess wird beim Plugin-Unload / Stop beendet.

Tunneln Sie niemals Port `3080` / `dsh web`. Ein selbst gehosteter Rendezvous-Worker (Desktop und Telefon beide outbound, Geschäftsframes weiterhin E2EE) ist optional; siehe [docs/05-cloud-relay.md](docs/05-cloud-relay.md). Er braucht einen Cloudflare-Workers-Paid-Plan und ist **kein** öffentliches Relay dieses Projekts.

## Sicherheit

Invarianten (vollständiges Modell: [docs/04-threat-model.md](docs/04-threat-model.md)):

1. Unauthentifizierte Verbindungen behandeln nur den Handshake.
2. `deviceToken` wird als SHA-256 gespeichert; Schlüssel und Registry-Dateien sind `0600`.
3. RPC-Allowlist, Standard ablehnen; Schreibvorgänge werden auf `deviceId` auditiert.
4. Die Verwaltungsebene ist Loopback + Host + CSRF.
5. Das Plugin schwächt `dsh web` `/api` nicht und übernimmt keine `api-proxy`-Provider.

**Ehrliche v0-Grenze:** der erste HTTP-Download von `/m` in einem rohen LAN kann MITM werden. Bevorzugen Sie ein Overlay-VPN.

Verbote:

- Teilen Sie keine fremden Zugangsdaten.
- Überwachen Sie keine Konten ohne Berechtigung.
- Binden Sie den Datenebenen-Port nicht auf `0.0.0.0` ans öffentliche Internet (ein vom Benutzer explizit gestarteter Quick Tunnel ist die Ausnahme).
- Unterstellen Sie keine offizielle DeepSeek-Unterstützung.

Beispiele in der Doku verwenden nur `example.com`, `127.0.0.1` und `YOUR_TOKEN`.

## Architektur

Zwei Ebenen, Modulkarte, Speicher und Handshake: [docs/02-architecture.md](docs/02-architecture.md) · [中文](docs/02-architecture.zh-CN.md).

MVP-Entscheidung (Route B): [docs/01-mvp-scope.md](docs/01-mvp-scope.md).

## Dokumentation

| Doc | Zweck |
|---|---|
| [INSTALL.md](INSTALL.md) | Installieren, koppeln, Tunnel |
| [CHANGELOG.md](CHANGELOG.md) | Release-Historie |
| [docs/00-project-rules.md](docs/00-project-rules.md) | Versionierung, öffentlich vs. nur lokal, Host-DSH-Grenze |
| [docs/01-mvp-scope.md](docs/01-mvp-scope.md) | ADR: MVP-Umfang (Chinesisch) |
| [docs/02-architecture.md](docs/02-architecture.md) | Interne Architektur · [中文](docs/02-architecture.zh-CN.md) |
| [docs/03-protocol.md](docs/03-protocol.md) | RPC-Allowlist und Push-Umschläge (Chinesisch) |
| [docs/04-threat-model.md](docs/04-threat-model.md) | Assets, Angreifer, Invarianten (Chinesisch) |
| [docs/05-cloud-relay.md](docs/05-cloud-relay.md) | Selbst gehosteter Rendezvous-Worker (M5) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Beitragsleitfaden |
| [AGENTS.md](AGENTS.md) | Agent-/Operator-Regeln (kein Produktions-Neustart) |

## Verwandt

- [dsh-coding-subscription-oauth](https://github.com/lninghaha/dsh-coding-subscription-oauth) — Schwester-Plugin; das Dokumentationslayout ist daran angelehnt.
- GitHub: [`lninghaha/dsh-coding-remote-kit`](https://github.com/lninghaha/dsh-coding-remote-kit).
- Dieses Plugin ist unabhängig vom Nutzungszentrum-Plugin `dsh-hub-oauth-gateway`.
- Es ersetzt nicht `@deepseek-ai/dsh`.

## Mitwirken

Issues und PRs sind willkommen. Siehe [CONTRIBUTING.md](CONTRIBUTING.md) für die Docker-Sandbox, Commit-Konventionen und Dokumentenschichten.

## Lizenz

[MIT](LICENSE).
