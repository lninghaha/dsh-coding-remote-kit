<!-- banner -->
<div align="center">

# dsh-coding-remote-kit

**v0.5.1** · DeepSeek Harness `0.1.0-rc.6` · GitHub `dsh-coding-remote-kit`

**[DeepSeek Harness](https://github.com/deepseek-ai/dsh)용 원격 휴대폰 접근.** 이미 `dsh web`을 실행 중인 데스크톱에 휴대폰을 페어링한 뒤, 세션을 관찰하고 좁은 범위의 쓰기만 수행합니다. 전체 Web API는 노출하지 않습니다.

[![npm](https://img.shields.io/npm/v/dsh-coding-remote-kit.svg)](https://www.npmjs.com/package/dsh-coding-remote-kit)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

*[English](README.md) · [中文版](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Português (BR)](README.pt-BR.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)*

</div>

---

> **Upgrade / 升级：** Follow the versioned steps in [`INSTALL.md`](INSTALL.md). Install into the existing `web` profile, keep profile/config/credential files, and restart one existing DSH Web process after all packages are updated. When Hub and Subscription are both used, `dsh-coding-oauth-core@0.1.0` is their shared npm dependency, not a separate DSH plugin.

---

커뮤니티 플러그인입니다. **DeepSeek와 무관하며 공식 후원도 없습니다.** 제품 의도는 데스크톱 IDE의 복제가 아니라 [Orca Mobile Companion](https://www.onorca.dev/docs/mobile)에 가깝습니다.

이 저장소를 변경하기 전에 [`AGENTS.md`](AGENTS.md)를 읽으세요: **프로덕션 `dsh-web`을 직접 재시작하지 마세요.** tarball만 준비하고, 재시작은 운영자가 합니다.

## 이름

처음 GitHub 저장소 이름은 `dsh-mobile-remote`였습니다. npm의 **`dsh-mobile-remote`는 다른 프로젝트**입니다(WeChat 원격 제어 플러그인). 이 플러그인의 공개 이름은 `dsh-coding-remote-kit`입니다.

| | 이것을 사용 | 설명 |
|---|---|---|
| npm | `dsh-coding-remote-kit@0.5.1` | `dsh plugin --profile web add dsh-coding-remote-kit@0.5.1` |
| GitHub | [`lninghaha/dsh-coding-remote-kit`](https://github.com/lninghaha/dsh-coding-remote-kit) | 이전 checkout 이름 `dsh-mobile-remote` |
| Cordis 플러그인 id | `mobile-remote` | 변경 없음 |
| 설정 페이지 HTTP | `/api/mobile-remote/*` | 변경 없음 |
| 저장소 | `$DSH_HOME/storages/mobile-remote/` | 변경 없음 |

**`dsh plugin add dsh-mobile-remote`를 실행하지 마세요** — 무관한 WeChat 플러그인이 설치됩니다.

## 상태

| 마일스톤 | 상태 |
| --- | --- |
| 조사 (Orca / DSH 생태계) | 완료 — [`docs/research/`](docs/research/) |
| M1 플러그인 골격 + ADR / 위협 모델 | 완료 |
| M2 페어링 / LAN 데이터 플레인 | 완료 |
| M3 좁은 RPC / 승인 | 완료 |
| M4 서명 HTTPS / 네이티브 앱 | 미착수 |
| M5 자체 호스팅 랑데부 Worker | 완료 — [`docs/05-cloud-relay.md`](docs/05-cloud-relay.md) |

## 기능

- **이중 언어 UI** — 데스크톱 설정과 휴대폰 companion은 중국어 / English（`?lang=` 또는 앱 내 전환; 기본은 `navigator.language`）。
- **한 번 페어링** — 데스크톱이 QR 코드 또는 8자리 PIN을 보여 줍니다. 휴대폰은 데스크톱 X25519 공개 키를 고정하고 `deviceToken`을 보관합니다(서버는 SHA-256만 저장).
- **듀얼 플레인** — 관리 경로는 루프백 `dsh web`에 남기고, 모바일 데이터 플레인은 전용 포트(기본 `6879`)의 RPC 허용 목록입니다.
- **핸드셰이크 후 E2EE** — `/m/ws`는 tweetnacl secretbox. 미인증 소켓은 세션 내용을 보지 못합니다.
- **좁은 쓰기** — 세션 관찰, 승인/질문에 응답, 짧은 회신. 무거운 편집은 데스크톱에 남깁니다.
- **사설망 우선** — LAN / Tailscale을 권장합니다. 선택적 Cloudflare Quick Tunnel은 **데이터 플레인만** 노출하며 포트 `3080`은 절대 노출하지 않습니다. 선택적 자체 호스팅 랑데부 Worker: 데스크톱과 휴대폰 모두 아웃바운드이며 업무 프레임은 E2EE를 유지합니다.
- **표준 플러그인 형태** — Cordis 서버 플러그인 하나 + classic-script 설정 페이지. `dsh plugin --profile web add`에는 **file tarball**을 쓰고, `link:` 작업 트리는 쓰지 않습니다.

## 스크린샷

<p align="center">
  <img src="docs/assets/en/settings-pairing.png" alt="데스크톱 설정 — QR 및 PIN 페어링" width="48%" />
  &nbsp;
  <img src="docs/assets/en/settings-overview.png" alt="데스크톱 설정 — 채널 상태와 페어링된 기기" width="48%" />
</p>
<p align="center"><em>데스크톱 Settings → Mobile Remote: 페어링 offer 생성(왼쪽) · 채널 상태와 기기(오른쪽)</em></p>

<p align="center">
  <img src="docs/assets/en/mobile-pair.png" alt="휴대폰 페어링 화면" width="28%" />
  &nbsp;&nbsp;
  <img src="docs/assets/en/mobile-sessions.png" alt="휴대폰 세션 목록" width="28%" />
</p>
<p align="center"><em>휴대폰: PIN 입력 / 스캔(왼쪽) · 페어링 후 세션 목록(오른쪽)</em></p>

## 이 플러그인이 해결하는 문제

| 검색 / 본 것 | 실제로 깨진 것 | 이 플러그인의 대응 |
|---|---|---|
| 「DSH용 Orca 스타일 휴대폰 companion」 | 공식 DSH에 일급 페어링 모바일 앱이 없음 | 의미론적 companion: 페어링 + E2EE + 허용 목록 RPC |
| 휴대폰의 `dsh-pocket` / `dsh-web-remote` | LAN/공용망의 전체 `dsh web` 면 | 듀얼 플레인. 알 수 없는 RPC 메서드는 `forbidden` |
| 휴대폰은 셀룰러, 데스크톱은 LAN | 생 LAN HTTP 페이지는 MITM될 수 있음 | Tailscale 우선. 선택적 Quick Tunnel(에지 TLS, 오리진은 localhost) |
| 플러그인 `import` 실패로 포트 3080이 죽음 | DSH가 플러그인 트리 전체를 fail-fast | 샌드박스 게이트 + 저장소 밖으로 복사한 tarball. `link:` 금지 |

## 빠른 시작

```bash
dsh plugin --profile web add dsh-coding-remote-kit@0.5.1
```

그다음 **운영자**가 자신의 시간창에서 기존 `dsh web`을 재시작합니다. **Settings → 移動远程**를 열고 페어링 offer를 만든 뒤, 휴대폰에서 QR을 스캔(또는 PIN 입력)합니다.

소스 checkout(개발)에서:

```bash
pnpm test:sandbox
pnpm pack
mkdir -p "$HOME/.dsh/packages"
cp dsh-coding-remote-kit-0.5.1.tgz "$HOME/.dsh/packages/"
dsh plugin --profile web add "$HOME/.dsh/packages/dsh-coding-remote-kit-0.5.1.tgz"
```

이 작업 트리에서 `dsh plugin add ./`를 실행하지 마세요. pnpm 11은 일부 `file:` tarball 경로를 `link:` 소스로 취급하며, 진입 import가 실패하면 GUI 전체가 내려갑니다.

## 목차

- [이름](#이름)
- [상태](#상태)
- [기능](#기능)
- [스크린샷](#스크린샷)
- [이 플러그인이 해결하는 문제](#이-플러그인이-해결하는-문제)
- [빠른 시작](#빠른-시작)
- [설치](#설치)
- [동작 방식](#동작-방식)
- [설정 페이지](#설정-페이지)
- [모바일 RPC](#모바일-rpc)
- [공용 터널](#공용-터널)
- [보안](#보안)
- [아키텍처](#아키텍처)
- [문서](#문서)
- [관련 프로젝트](#관련-프로젝트)
- [기여](#기여)
- [라이선스](#라이선스)

## 설치

DeepSeek Harness `0.1.0-rc.6`(고정)과 Node.js 22.19+가 필요합니다. 전체 단계, 페어링, 터널 설명은 [INSTALL.md](INSTALL.md)를 보세요.

개발:

```bash
pnpm install && pnpm build && pnpm test   # inside the Docker sandbox, not on a live GUI host
pnpm test:sandbox                         # Dockerfile targets check / isolated-install / verify
```

빌드 산출물:

- `lib/server/index.js` — Cordis 진입점 (`name` / `inject` / `Config` / `apply`)
- `lib/client.js` — 설정 페이지 classic-script
- `lib/mobile/` — `/m`에서 제공되는 휴대폰 페이지

## 동작 방식

```text
Settings (loopback)          Phone browser
        │                            │
        │  QR / PIN  ────────────────┤
        ▼                            ▼
 /api/mobile-remote/*          GET /m  +  WS /m/ws
   (dsh web, :3080)            (data plane, :6879, E2EE)
```

관리 면은 호스트 Web의 루프백 울타리 안에 남습니다. 데이터 플레인은 별도의 `node:http` + `ws` 서버입니다. 페어링이 LAN 클라이언트가 연결할 수 있도록 `127.0.0.1`에서 `0.0.0.0`으로 다시 바인드할 수 있습니다. 활성 Quick Tunnel이 있으면 HTTPS origin을 광고하고 바인드를 넓히지 않습니다.

## 설정 페이지

**Settings → 移動远程**를 엽니다:

- 상태 (bind, 포트, 수신 중, 활성 기기, 터널, 랑데부)
- **LAN** / **Quick Tunnel** / **rendezvous** 채널
- offer 생성 → QR + 8자리 PIN
- 기기 목록과 철회
- 선택적 공식 `cloudflared` 설치 (플러그인 `apply()` 시에는 절대 실행하지 않음)

## 모바일 RPC

허용 목록 메서드(나머지는 모두 `forbidden`):

`status.get` · `session.list` · `session.history` · `session.subscribe` · `session.unsubscribe` · `host.subscribe` · `session.prompt` · `session.cancel` · `session.create` · `respond`

푸시에는 세션 이벤트와 `respond`용 `rpcId`가 있는 `approval.requested` / `question.requested`가 포함됩니다. 와이어 형식: [docs/03-protocol.md](docs/03-protocol.md).

## 공용 터널

기본값은 **꺼짐**. 설정에서 시작하면 `cloudflared` Quick Tunnel은 **`127.0.0.1:<data-plane-port>`만** 가리킵니다. `/m`은 `https://<random>.trycloudflare.com` URL에서 도달할 수 있습니다. 페어링에는 여전히 프래그먼트 토큰(또는 PIN)과 E2EE가 필요합니다. 자식 프로세스는 플러그인 unload / Stop 시 kill됩니다.

포트 `3080` / `dsh web`을 터널하지 마세요. 자체 호스팅 랑데부 Worker(데스크톱과 휴대폰 모두 아웃바운드, 업무 프레임은 E2EE)는 선택입니다. [docs/05-cloud-relay.md](docs/05-cloud-relay.md)를 보세요. Cloudflare Workers Paid 플랜이 필요하며, **이 프로젝트가 운영하는 공용 릴레이가 아닙니다**.

## 보안

불변 조건(전체 모델: [docs/04-threat-model.md](docs/04-threat-model.md)):

1. 미인증 연결은 핸드셰이크만 처리합니다.
2. `deviceToken`은 SHA-256으로 저장됩니다. 키와 레지스트리 파일은 `0600`입니다.
3. RPC 허용 목록, 기본 거부. 쓰기는 `deviceId`로 감사됩니다.
4. 관리 플레인은 루프백 + Host + CSRF입니다.
5. 플러그인은 `dsh web` `/api`를 약화하지 않으며 `api-proxy` 프로바이더를 가로채지 않습니다.

**정직한 v0 경계:** 생 LAN에서 `/m`의 첫 HTTP 다운로드는 MITM될 수 있습니다. overlay VPN을 우선하세요.

금지 사항:

- 다른 사람의 자격 증명을 공유하지 마세요.
- 권한이 없는 계정을 감시하지 마세요.
- 데이터 플레인 포트를 `0.0.0.0`으로 공용 인터넷에 바인드하지 마세요(사용자가 명시적으로 시작한 Quick Tunnel은 예외).
- DeepSeek 공식 후원을 암시하지 마세요.

문서 예시는 `example.com`, `127.0.0.1`, `YOUR_TOKEN`만 사용합니다.

## 아키텍처

듀얼 플레인, 모듈 맵, 저장소, 핸드셰이크: [docs/02-architecture.md](docs/02-architecture.md) · [中文](docs/02-architecture.zh-CN.md).

MVP 결정(경로 B): [docs/01-mvp-scope.md](docs/01-mvp-scope.md).

## 문서

| 문서 | 용도 |
|---|---|
| [INSTALL.md](INSTALL.md) | 설치, 페어링, 터널 |
| [CHANGELOG.md](CHANGELOG.md) | 릴리스 이력 |
| [docs/00-project-rules.md](docs/00-project-rules.md) | 버전, 공개 vs 로컬 전용, 호스트 DSH 경계 |
| [docs/01-mvp-scope.md](docs/01-mvp-scope.md) | ADR: MVP 범위 (중국어) |
| [docs/02-architecture.md](docs/02-architecture.md) | 내부 아키텍처 · [中文](docs/02-architecture.zh-CN.md) |
| [docs/03-protocol.md](docs/03-protocol.md) | RPC 허용 목록과 푸시 엔벨로프 (중국어) |
| [docs/04-threat-model.md](docs/04-threat-model.md) | 자산, 공격자, 불변 조건 (중국어) |
| [docs/05-cloud-relay.md](docs/05-cloud-relay.md) | 자체 호스팅 랑데부 Worker (M5) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 기여 가이드 |
| [AGENTS.md](AGENTS.md) | Agent/운영자 규칙 (프로덕션 재시작 금지) |

## 관련 프로젝트

- [dsh-coding-subscription-oauth](https://github.com/lninghaha/dsh-coding-subscription-oauth) — 형제 플러그인. 문서 레이아웃의 본보기.
- GitHub: [`lninghaha/dsh-coding-remote-kit`](https://github.com/lninghaha/dsh-coding-remote-kit).
- 이 플러그인은 사용량 센터 플러그인 `dsh-hub-oauth-gateway`와 독립입니다.
- `@deepseek-ai/dsh`를 대체하지 않습니다.

## 기여

이슈와 PR을 환영합니다. Docker 샌드박스, 커밋 규칙, 문서 계층은 [CONTRIBUTING.md](CONTRIBUTING.md)를 보세요.

## 라이선스

[MIT](LICENSE).
