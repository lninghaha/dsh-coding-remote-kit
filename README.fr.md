<!-- banner -->
<div align="center">

# dsh-coding-remote-kit

**v0.4.0** · DeepSeek Harness `0.1.0-rc.6` · GitHub `dsh-coding-remote-kit`

**Accès distant par téléphone pour [DeepSeek Harness](https://github.com/deepseek-ai/dsh).** Appariez un téléphone au bureau qui exécute déjà `dsh web`, observez les sessions et effectuez un ensemble restreint d'écritures — sans exposer l'API Web complète.

[![npm](https://img.shields.io/npm/v/dsh-coding-remote-kit.svg)](https://www.npmjs.com/package/dsh-coding-remote-kit)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

*[English](README.md) · [中文版](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Português (BR)](README.pt-BR.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)*

</div>

---

> **Upgrade / 升级：** Follow the versioned steps in [`INSTALL.md`](INSTALL.md). Install into the existing `web` profile, keep profile/config/credential files, and restart one existing DSH Web process after all packages are updated. When Hub and Subscription are both used, `dsh-coding-oauth-core@0.1.0` is their shared npm dependency, not a separate DSH plugin.

---

Plugin communautaire. **Non affilié à DeepSeek, et non approuvé par DeepSeek.** L'intention produit est plus proche d'[Orca Mobile Companion](https://www.onorca.dev/docs/mobile) que d'une seconde copie de l'IDE de bureau.

Lisez [`AGENTS.md`](AGENTS.md) avant de modifier ce dépôt : **ne redémarrez pas vous-même le `dsh-web` de production.** Préparez le tarball ; l'opérateur redémarre.

## Noms

Développé d'abord sous le nom GitHub `dsh-mobile-remote`. Le nom npm **`dsh-mobile-remote` est un autre projet** (plugin de télécommande WeChat). Ce plugin est publié sous `dsh-coding-remote-kit`.

| | Utilisez ceci | Notes |
|---|---|---|
| npm | `dsh-coding-remote-kit@0.4.0` | `dsh plugin --profile web add dsh-coding-remote-kit@0.4.0` |
| GitHub | [`lninghaha/dsh-coding-remote-kit`](https://github.com/lninghaha/dsh-coding-remote-kit) | ancien nom de checkout `dsh-mobile-remote` |
| id du plugin Cordis | `mobile-remote` | inchangé |
| HTTP de la page Réglages | `/api/mobile-remote/*` | inchangé |
| Stockage | `$DSH_HOME/storages/mobile-remote/` | inchangé |

Ne faites **pas** `dsh plugin add dsh-mobile-remote` — cela installe le plugin WeChat sans rapport.

## État

| Jalon | État |
| --- | --- |
| Recherche (Orca / écosystème DSH) | terminé — [`docs/research/`](docs/research/) |
| M1 squelette du plugin + ADR / modèle de menaces | terminé |
| M2 appariement / plan de données LAN | terminé |
| M3 RPC restreint / approbations | terminé |
| M4 HTTPS signé / application native | non commencé |
| M5 Worker de rendez-vous auto-hébergé | terminé — [`docs/05-cloud-relay.md`](docs/05-cloud-relay.md) |

## Fonctionnalités

- **UI bilingue** — chinois et anglais pour les Réglages bureau et le companion téléphone (`?lang=` / bascule in-app ; défaut `navigator.language`).
- **Apparier une fois** — le bureau affiche un QR code ou un PIN à 8 chiffres ; le téléphone épingle la clé publique X25519 du bureau et conserve un `deviceToken` (le serveur ne stocke que le SHA-256).
- **Double plan** — les routes de gestion restent sur le `dsh web` en loopback ; le plan de données mobile est un port dédié (par défaut `6879`) avec une liste blanche RPC.
- **E2EE après le handshake** — tweetnacl secretbox sur `/m/ws` ; les sockets non authentifiés ne voient jamais le contenu de session.
- **Écritures restreintes** — observer les sessions, répondre aux approbations/questions, réponses courtes ; l'édition lourde reste sur le bureau.
- **Réseau privé d'abord** — LAN / Tailscale préférés. Le Cloudflare Quick Tunnel optionnel n'expose **que** le plan de données, jamais le port `3080`. Worker de rendez-vous auto-hébergé optionnel : bureau et téléphone sortent tous deux en outbound ; les trames métier restent E2EE.
- **Forme standard de plugin** — un plugin Cordis serveur + page Réglages classic-script. `dsh plugin --profile web add` avec un **file tarball**, jamais un arbre de travail `link:`.

## Captures d'écran

<p align="center">
  <img src="docs/assets/en/settings-pairing.png" alt="Réglages bureau — offre d'appariement avec QR et PIN" width="48%" />
  &nbsp;
  <img src="docs/assets/en/settings-overview.png" alt="Réglages bureau — état du canal et appareils appariés" width="48%" />
</p>
<p align="center"><em>Bureau Settings → Mobile Remote : créer une offre d'appariement (gauche) · état du canal et appareils (droite)</em></p>

<p align="center">
  <img src="docs/assets/en/mobile-pair.png" alt="Écran d'appariement sur le téléphone" width="28%" />
  &nbsp;&nbsp;
  <img src="docs/assets/en/mobile-sessions.png" alt="Liste des sessions sur le téléphone" width="28%" />
</p>
<p align="center"><em>Companion téléphone : saisir le PIN / scanner (gauche) · liste des sessions après appariement (droite)</em></p>

## Problèmes que ce plugin résout

| Vous avez cherché / vu | Ce qui était vraiment cassé | Ce que fait ce plugin |
|---|---|---|
| « companion téléphone style Orca pour DSH » | DSH officiel n'a pas d'app mobile appariée de première classe | Companion sémantique : appariement + E2EE + RPC en liste blanche |
| `dsh-pocket` / `dsh-web-remote` sur un téléphone | Surface complète de `dsh web` sur LAN/public | Double plan ; les méthodes RPC inconnues sont `forbidden` |
| Téléphone en cellulaire, bureau en LAN | Une page HTTP LAN brute peut être MITM | Préférer Tailscale ; Quick Tunnel optionnel (TLS au bord, origine localhost) |
| L'`import` du plugin a échoué et le port 3080 est mort | DSH fait fail-fast de tout l'arbre de plugins | Porte sandbox + tarball copié *hors* du dépôt ; pas de `link:` |

## Démarrage rapide

```bash
dsh plugin --profile web add dsh-coding-remote-kit@0.4.0
```

Ensuite l'**opérateur** redémarre le processus `dsh web` existant dans sa propre fenêtre. Ouvrez **Settings → 移動远程**, créez une offre d'appariement, scannez le QR (ou saisissez le PIN) sur le téléphone.

Depuis un checkout source (développement) :

```bash
pnpm test:sandbox
pnpm pack
mkdir -p "$HOME/.dsh/packages"
cp dsh-coding-remote-kit-0.4.0.tgz "$HOME/.dsh/packages/"
dsh plugin --profile web add "$HOME/.dsh/packages/dsh-coding-remote-kit-0.4.0.tgz"
```

Ne faites pas `dsh plugin add ./` depuis cet arbre de travail. pnpm 11 traite certains chemins `file:` de tarball comme source `link:`, et un import d'entrée raté fait tomber toute la GUI.

## Table des matières

- [Noms](#noms)
- [État](#état)
- [Fonctionnalités](#fonctionnalités)
- [Captures d'écran](#captures-décran)
- [Problèmes que ce plugin résout](#problèmes-que-ce-plugin-résout)
- [Démarrage rapide](#démarrage-rapide)
- [Installation](#installation)
- [Fonctionnement](#fonctionnement)
- [Page des paramètres](#page-des-paramètres)
- [RPC mobile](#rpc-mobile)
- [Tunnel public](#tunnel-public)
- [Sécurité](#sécurité)
- [Architecture](#architecture)
- [Documentation](#documentation)
- [Projets connexes](#projets-connexes)
- [Contribution](#contribution)
- [Licence](#licence)

## Installation

Nécessite DeepSeek Harness `0.1.0-rc.6` (épinglé) et Node.js 22.19+. Étapes complètes, appariement et notes de tunnel : [INSTALL.md](INSTALL.md).

Développement :

```bash
pnpm install && pnpm build && pnpm test   # inside the Docker sandbox, not on a live GUI host
pnpm test:sandbox                         # Dockerfile targets check / isolated-install / verify
```

Sorties de build :

- `lib/server/index.js` — entrée Cordis (`name` / `inject` / `Config` / `apply`)
- `lib/client.js` — classic-script de la page Réglages
- `lib/mobile/` — page téléphone servie sur `/m`

## Fonctionnement

```text
Settings (loopback)          Phone browser
        │                            │
        │  QR / PIN  ────────────────┤
        ▼                            ▼
 /api/mobile-remote/*          GET /m  +  WS /m/ws
   (dsh web, :3080)            (data plane, :6879, E2EE)
```

La gestion reste derrière la clôture loopback du Web hôte. Le plan de données est un serveur séparé `node:http` + `ws`. L'appariement peut le relier de `127.0.0.1` à `0.0.0.0` pour les clients LAN ; un Quick Tunnel actif annonce son origine HTTPS au lieu d'élargir le bind.

## Page des paramètres

Ouvrez **Settings → 移動远程** :

- état (bind, port, écoute, appareils actifs, tunnel, rendez-vous)
- canaux **LAN** / **Quick Tunnel** / **rendezvous**
- créer une offre → QR + PIN à 8 chiffres
- liste des appareils et révocation
- installation optionnelle du `cloudflared` officiel (jamais lancée au `apply()` du plugin)

## RPC mobile

Méthodes en liste blanche (tout le reste est `forbidden`) :

`status.get` · `session.list` · `session.history` · `session.subscribe` · `session.unsubscribe` · `host.subscribe` · `session.prompt` · `session.cancel` · `session.create` · `respond`

Les pushes incluent les événements de session plus `approval.requested` / `question.requested` (avec `rpcId` pour `respond`). Format filaire : [docs/03-protocol.md](docs/03-protocol.md).

## Tunnel public

Par défaut **éteint**. Quand il est démarré depuis Réglages, le Quick Tunnel `cloudflared` pointe **uniquement** vers `127.0.0.1:<data-plane-port>`. `/m` devient joignable sur une URL `https://<random>.trycloudflare.com` ; l'appariement a toujours besoin du jeton de fragment (ou du PIN) et de l'E2EE. Le processus enfant est tué au unload / Stop du plugin.

Ne tunnelez jamais le port `3080` / `dsh web`. Un Worker de rendez-vous auto-hébergé (bureau et téléphone tous deux outbound, trames métier toujours E2EE) est optionnel ; voir [docs/05-cloud-relay.md](docs/05-cloud-relay.md). Il faut un plan Cloudflare Workers Paid et ce n'est **pas** un relais public opéré par ce projet.

## Sécurité

Invariants (modèle complet : [docs/04-threat-model.md](docs/04-threat-model.md)) :

1. Les connexions non authentifiées ne gèrent que le handshake.
2. `deviceToken` est stocké en SHA-256 ; les clés et fichiers de registre sont `0600`.
3. Liste blanche RPC, refus par défaut ; les écritures sont auditées vers `deviceId`.
4. Le plan de gestion est loopback + Host + CSRF.
5. Le plugin n'affaiblit pas `/api` de `dsh web` et ne s'empare pas des fournisseurs `api-proxy`.

**Frontière honnête de v0 :** le premier téléchargement HTTP de `/m` sur un LAN brut peut être MITM. Préférez un VPN overlay.

Interdictions :

- Ne partagez pas les identifiants d'une autre personne.
- Ne surveillez pas des comptes sans autorisation.
- Ne liez pas le port du plan de données sur `0.0.0.0` à l'Internet public (le Quick Tunnel démarré explicitement par l'utilisateur est l'exception).
- N'impliquez pas un soutien officiel de DeepSeek.

Les exemples de la documentation n'utilisent que `example.com`, `127.0.0.1` et `YOUR_TOKEN`.

## Architecture

Double plan, carte des modules, stockage et handshake : [docs/02-architecture.md](docs/02-architecture.md) · [中文](docs/02-architecture.zh-CN.md).

Décision MVP (voie B) : [docs/01-mvp-scope.md](docs/01-mvp-scope.md).

## Documentation

| Doc | Objet |
|---|---|
| [INSTALL.md](INSTALL.md) | Installer, apparier, tunnel |
| [CHANGELOG.md](CHANGELOG.md) | Historique des versions |
| [docs/00-project-rules.md](docs/00-project-rules.md) | Versionnage, publier vs local-only, limite DSH hôte |
| [docs/01-mvp-scope.md](docs/01-mvp-scope.md) | ADR : périmètre MVP (chinois) |
| [docs/02-architecture.md](docs/02-architecture.md) | Architecture interne · [中文](docs/02-architecture.zh-CN.md) |
| [docs/03-protocol.md](docs/03-protocol.md) | Liste blanche RPC et enveloppes push (chinois) |
| [docs/04-threat-model.md](docs/04-threat-model.md) | Actifs, attaquants, invariants (chinois) |
| [docs/05-cloud-relay.md](docs/05-cloud-relay.md) | Worker de rendez-vous auto-hébergé (M5) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Guide de contribution |
| [AGENTS.md](AGENTS.md) | Règles agent/opérateur (pas de redémarrage production) |

## Projets connexes

- [dsh-coding-subscription-oauth](https://github.com/lninghaha/dsh-coding-subscription-oauth) — plugin frère ; la mise en page de la documentation s'en inspire.
- GitHub : [`lninghaha/dsh-coding-remote-kit`](https://github.com/lninghaha/dsh-coding-remote-kit).
- Ce plugin est indépendant du plugin centre d'usage `dsh-hub-oauth-gateway`.
- Il ne remplace pas `@deepseek-ai/dsh`.

## Contribution

Issues et PR bienvenues. Voir [CONTRIBUTING.md](CONTRIBUTING.md) pour le sandbox Docker, les conventions de commit et les couches documentaires.

## Licence

[MIT](LICENSE).
