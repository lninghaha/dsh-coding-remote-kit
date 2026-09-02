<!-- banner -->
<div align="center">

# dsh-coding-remote-kit

**v0.5.2** · DeepSeek Harness `0.1.1-rc.2` · GitHub `dsh-coding-remote-kit`

**[DeepSeek Harness](https://github.com/deepseek-ai/dsh) 向けのリモートスマホアクセス。** すでに `dsh web` が動いているデスクトップにスマホをペアリングし、セッションを観察して限定された書き込みだけを行う——フル Web API は公開しません。

[![npm](https://img.shields.io/npm/v/dsh-coding-remote-kit.svg)](https://www.npmjs.com/package/dsh-coding-remote-kit)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

*[English](README.md) · [中文版](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Português (BR)](README.pt-BR.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)*

</div>

---

> **Upgrade / 升级：** Follow the versioned steps in [`INSTALL.md`](INSTALL.md). Install into the existing `web` profile, keep profile/config/credential files, and restart one existing DSH Web process after all packages are updated. When Hub and Subscription are both used, `dsh-coding-oauth-core@0.1.0` is their shared npm dependency, not a separate DSH plugin.

---

コミュニティプラグインです。**DeepSeek とは無関係であり、公式の後援もありません。** 製品意図はデスクトップ IDE の複製ではなく、[Orca Mobile Companion](https://www.onorca.dev/docs/mobile) に近いです。

このリポジトリを変更する前に [`AGENTS.md`](AGENTS.md) を読んでください：**本番の `dsh-web` を自分で再起動しないでください。** tarball を用意し、再起動はオペレーターが行います。

## 名称

当初の GitHub リポジトリ名は `dsh-mobile-remote` でした。npm 上の **`dsh-mobile-remote` は別プロジェクト**（WeChat リモコンプラグイン）です。本プラグインの公開名は `dsh-coding-remote-kit` です。

| | これを使う | 説明 |
|---|---|---|
| npm | `dsh-coding-remote-kit@0.5.2` | `dsh plugin --profile web add dsh-coding-remote-kit@0.5.2` |
| GitHub | [`lninghaha/dsh-coding-remote-kit`](https://github.com/lninghaha/dsh-coding-remote-kit) | 旧 checkout 名 `dsh-mobile-remote` |
| Cordis プラグイン id | `mobile-remote` | 変更なし |
| 設定ページ HTTP | `/api/mobile-remote/*` | 変更なし |
| ストレージ | `$DSH_HOME/storages/mobile-remote/` | 変更なし |

**`dsh plugin add dsh-mobile-remote` は実行しないでください** — 無関係な WeChat プラグインが入ります。

## 状態

| マイルストーン | 状態 |
| --- | --- |
| 調査（Orca / DSH エコシステム） | 完了 — [`docs/research/`](docs/research/) |
| M1 プラグイン骨格 + ADR / 脅威モデル | 完了 |
| M2 ペアリング / LAN データプレーン | 完了 |
| M3 狭い RPC / 承認 | 完了 |
| M4 署名付き HTTPS / ネイティブアプリ | 未着手 |
| M5 自前ランデブー Worker | 完了 — [`docs/05-cloud-relay.md`](docs/05-cloud-relay.md) |

## 特徴

- **二言語 UI** — デスクトップ設定とスマホ companion は中国語 / English（`?lang=` またはアプリ内切替；既定は `navigator.language`）。
- **一度ペアリング** — デスクトップが QR コードまたは 8 桁 PIN を表示。スマホはデスクトップの X25519 公開鍵をピン留めし、`deviceToken` を保持します（サーバーは SHA-256 のみ保存）。
- **デュアルプレーン** — 管理ルートはループバックの `dsh web` に残し、モバイルデータプレーンは専用ポート（既定 `6879`）上の RPC 許可リストです。
- **ハンドシェイク後の E2EE** — `/m/ws` は tweetnacl secretbox。未認証ソケットはセッション内容を見ません。
- **狭い書き込み** — セッション観察、承認/質問への応答、短い返信。重い編集はデスクトップに残します。
- **プライベートネットワーク優先** — LAN / Tailscale を推奨。任意の Cloudflare Quick Tunnel は **データプレーンのみ** を公開し、ポート `3080` は決して公開しません。任意の自前ランデブー Worker：デスクトップとスマホはどちらも出向き、業務フレームは E2EE のままです。
- **標準プラグイン形** — Cordis サーバープラグイン 1 つ + classic-script 設定ページ。`dsh plugin --profile web add` には **file tarball** を使い、`link:` 作業ツリーは使いません。

## スクリーンショット

<p align="center">
  <img src="docs/assets/en/settings-pairing.png" alt="デスクトップ設定 — QR と PIN のペアリング" width="48%" />
  &nbsp;
  <img src="docs/assets/en/settings-overview.png" alt="デスクトップ設定 — チャネル状態とペア済みデバイス" width="48%" />
</p>
<p align="center"><em>デスクトップ Settings → Mobile Remote：ペアリング offer（左）· チャネル状態とデバイス（右）</em></p>

<p align="center">
  <img src="docs/assets/en/mobile-pair.png" alt="スマホのペアリング画面" width="28%" />
  &nbsp;&nbsp;
  <img src="docs/assets/en/mobile-sessions.png" alt="スマホのセッション一覧" width="28%" />
</p>
<p align="center"><em>スマホ：PIN 入力 / スキャン（左）· ペアリング後のセッション一覧（右）</em></p>

## このプラグインが解決する問題

| 検索 / 見たもの | 実際に壊れていたこと | このプラグインの対応 |
|---|---|---|
| 「DSH 向け Orca 風スマホ companion」 | 公式 DSH に一等のペアリングモバイルアプリがない | セマンティック companion：ペアリング + E2EE + 許可リスト RPC |
| スマホ上の `dsh-pocket` / `dsh-web-remote` | LAN/公開網上のフル `dsh web` 面 | デュアルプレーン。未知の RPC メソッドは `forbidden` |
| スマホはセルラー、デスクトップは LAN | 生の LAN HTTP ページは MITM され得る | Tailscale を優先。任意の Quick Tunnel（エッジで TLS、オリジンは localhost） |
| プラグイン `import` 失敗でポート 3080 が落ちた | DSH はプラグインツリー全体を fail-fast する | サンドボックス門禁 + リポジトリ外へコピーした tarball。`link:` 禁止 |

## クイックスタート

```bash
dsh plugin --profile web add dsh-coding-remote-kit@0.5.2
```

その後、**オペレーター** が自分の時間枠で既存の `dsh web` を再起動します。**Settings → 移動远程** を開き、ペアリング offer を作成し、スマホで QR をスキャン（または PIN を入力）します。

ソース checkout（開発）から:

```bash
pnpm test:sandbox
pnpm pack
mkdir -p "$HOME/.dsh/packages"
cp dsh-coding-remote-kit-0.5.2.tgz "$HOME/.dsh/packages/"
dsh plugin --profile web add "$HOME/.dsh/packages/dsh-coding-remote-kit-0.5.2.tgz"
```

この作業ツリーに対して `dsh plugin add ./` を実行しないでください。pnpm 11 は一部の `file:` tarball パスを `link:` ソースとして扱い、入口 import が失敗すると GUI 全体が落ちます。

## 目次

- [名称](#名称)
- [状態](#状態)
- [特徴](#特徴)
- [スクリーンショット](#スクリーンショット)
- [このプラグインが解決する問題](#このプラグインが解決する問題)
- [クイックスタート](#クイックスタート)
- [インストール](#インストール)
- [仕組み](#仕組み)
- [設定ページ](#設定ページ)
- [モバイル RPC](#モバイル-rpc)
- [公開トンネル](#公開トンネル)
- [セキュリティ](#セキュリティ)
- [アーキテクチャ](#アーキテクチャ)
- [ドキュメント](#ドキュメント)
- [関連プロジェクト](#関連プロジェクト)
- [コントリビュート](#コントリビュート)
- [ライセンス](#ライセンス)

## インストール

DeepSeek Harness `0.1.1-rc.2`（ピン留め）と Node.js 22.19+ が必要です。手順、ペアリング、トンネルの詳細は [INSTALL.md](INSTALL.md) を参照してください。

開発:

```bash
pnpm install && pnpm build && pnpm test   # inside the Docker sandbox, not on a live GUI host
pnpm test:sandbox                         # Dockerfile targets check / isolated-install / verify
```

ビルド成果物:

- `lib/server/index.js` — Cordis 入口（`name` / `inject` / `Config` / `apply`）
- `lib/client.js` — 設定ページ classic-script
- `lib/mobile/` — `/m` で提供されるスマホページ

## 仕組み

```text
Settings (loopback)          Phone browser
        │                            │
        │  QR / PIN  ────────────────┤
        ▼                            ▼
 /api/mobile-remote/*          GET /m  +  WS /m/ws
   (dsh web, :3080)            (data plane, :6879, E2EE)
```

管理面はホスト Web のループバック囲いの内側に残します。データプレーンは独立した `node:http` + `ws` サーバーです。ペアリング時に `127.0.0.1` から `0.0.0.0` へ再バインドして LAN クライアントが接続できるようにする場合があります。稼働中の Quick Tunnel があるときは HTTPS origin を広告し、バインドを広げません。

## 設定ページ

**Settings → 移動远程** を開きます:

- 状態（bind、ポート、リスン中か、アクティブ端末、トンネル、ランデブー）
- **LAN** / **Quick Tunnel** / **rendezvous** チャネル
- offer 作成 → QR + 8 桁 PIN
- 端末一覧と取り消し
- 任意の公式 `cloudflared` インストール（プラグイン `apply()` 時には決して実行しません）
- 接続診断（マスク済み候補、cloudflared ピン／検証、免責バージョン）
- Quick Tunnel 免責チェックボックス（Start 前に必須）

## モバイル RPC

許可リストのメソッド（それ以外はすべて `forbidden`）:

`status.get` · `session.list` · `session.history` · `session.subscribe` · `session.unsubscribe` · `host.subscribe` · `session.prompt` · `session.cancel` · `session.create` · `respond` · `device.name`

プッシュにはセッションイベントに加え、`respond` 用の `rpcId` 付き `approval.requested` / `question.requested` が含まれます。ワイヤ形式: [docs/03-protocol.md](docs/03-protocol.md)。

## 公開トンネル

既定は **オフ**。設定ページで免責に同意（`disclaimerAccepted: true`）してから Start。`cloudflared` Quick Tunnel は **`127.0.0.1:<data-plane-port>` だけ** を指します。`/m` は `https://<random>.trycloudflare.com` URL で到達可能になります。ペアリングには引き続きフラグメントトークン（または PIN）と E2EE が必要です。子プロセスはプラグイン unload / Stop 時に kill されます。

ポート `3080` / `dsh web` をトンネルしてはいけません。自前ランデブー Worker（デスクトップとスマホはどちらも出向き、業務フレームは E2EE のまま）は任意です。[docs/05-cloud-relay.md](docs/05-cloud-relay.md) を参照。Cloudflare Workers Paid プランが必要で、**本プロジェクトが運用する公開リレーではありません**。

## セキュリティ

不変条件（完全なモデル: [docs/04-threat-model.md](docs/04-threat-model.md)）:

1. 未認証接続はハンドシェイクのみ処理します。
2. `deviceToken` は SHA-256 として保存。鍵と登録ファイルは `0600`。
3. RPC 許可リスト、既定拒否。書き込みは `deviceId` に監査されます。
4. 管理プレーンはループバック + Host + CSRF。
5. プラグインは `dsh web` `/api` を弱めず、`api-proxy` プロバイダーを奪いません。

**v0 の正直な境界:** 生の LAN 上での `/m` の初回 HTTP ダウンロードは MITM され得ます。overlay VPN を優先してください。

禁止事項:

- 他人の資格情報を共有しない。
- 権限のないアカウントを監視しない。
- データプレーンポートを `0.0.0.0` で公衆インターネットにバインドしない（ユーザーが明示的に開始した Quick Tunnel は例外）。
- DeepSeek 公式の後援を暗示しない。

ドキュメントの例は `example.com`、`127.0.0.1`、`YOUR_TOKEN` のみを使います。

## アーキテクチャ

デュアルプレーン、モジュールマップ、ストレージ、ハンドシェイク: [docs/02-architecture.md](docs/02-architecture.md) · [中文](docs/02-architecture.zh-CN.md)。

MVP 決定（ルート B）: [docs/01-mvp-scope.md](docs/01-mvp-scope.md)。

## ドキュメント

| ドキュメント | 用途 |
|---|---|
| [INSTALL.md](INSTALL.md) | インストール、ペアリング、トンネル |
| [CHANGELOG.md](CHANGELOG.md) | リリース履歴 |
| [docs/00-project-rules.md](docs/00-project-rules.md) | バージョニング、公開 vs ローカル専用、ホスト DSH 境界 |
| [docs/01-mvp-scope.md](docs/01-mvp-scope.md) | ADR: MVP 範囲（中国語） |
| [docs/02-architecture.md](docs/02-architecture.md) | 内部アーキテクチャ · [中文](docs/02-architecture.zh-CN.md) |
| [docs/03-protocol.md](docs/03-protocol.md) | RPC 許可リストとプッシュエンベロープ（中国語） |
| [docs/04-threat-model.md](docs/04-threat-model.md) | 資産、攻撃者、不変条件（中国語） |
| [docs/05-cloud-relay.md](docs/05-cloud-relay.md) | 自前ランデブー Worker（M5） |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 貢献ガイド |
| [AGENTS.md](AGENTS.md) | Agent / オペレーター規則（本番再起動禁止） |

## 関連プロジェクト

- [dsh-coding-subscription-oauth](https://github.com/lninghaha/dsh-coding-subscription-oauth) — 兄弟プラグイン。ドキュメント構成の手本。
- GitHub: [`lninghaha/dsh-coding-remote-kit`](https://github.com/lninghaha/dsh-coding-remote-kit)。
- 本プラグインは利用量センタープラグイン `dsh-hub-oauth-gateway` とは独立です。
- `@deepseek-ai/dsh` の代替ではありません。

## コントリビュート

Issue と PR を歓迎します。Docker サンドボックス、コミット規約、ドキュメント層は [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。

## ライセンス

[MIT](LICENSE)。
