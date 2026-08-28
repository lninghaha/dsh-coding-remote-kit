<!-- banner -->
<div align="center">

# dsh-coding-remote-kit

**v0.5.0** · DeepSeek Harness `0.1.0-rc.6` · GitHub `dsh-coding-remote-kit`

**Acesso remoto pelo celular ao [DeepSeek Harness](https://github.com/deepseek-ai/dsh).** Emparelhe um celular ao desktop que já executa `dsh web`, observe sessões e faça um conjunto restrito de escritas — sem expor a API Web completa.

[![npm](https://img.shields.io/npm/v/dsh-coding-remote-kit.svg)](https://www.npmjs.com/package/dsh-coding-remote-kit)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

*[English](README.md) · [中文版](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Português (BR)](README.pt-BR.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)*

</div>

---

> **Upgrade / 升级：** Follow the versioned steps in [`INSTALL.md`](INSTALL.md). Install into the existing `web` profile, keep profile/config/credential files, and restart one existing DSH Web process after all packages are updated. When Hub and Subscription are both used, `dsh-coding-oauth-core@0.1.0` is their shared npm dependency, not a separate DSH plugin.

---

Plugin da comunidade. **Não é afiliado nem endossado pela DeepSeek.** A intenção do produto está mais próxima do [Orca Mobile Companion](https://www.onorca.dev/docs/mobile) do que de uma segunda cópia da IDE desktop.

Leia [`AGENTS.md`](AGENTS.md) antes de alterar este repositório: **não reinicie o `dsh-web` de produção você mesmo.** Prepare o tarball; o operador reinicia.

## Nomes

Desenvolvido primeiro como GitHub `dsh-mobile-remote`. O nome npm **`dsh-mobile-remote` é outro projeto** (plugin de controle remoto WeChat). Este plugin publica como `dsh-coding-remote-kit`.

| | Use isto | Notas |
|---|---|---|
| npm | `dsh-coding-remote-kit@0.5.0` | `dsh plugin --profile web add dsh-coding-remote-kit@0.5.0` |
| GitHub | [`lninghaha/dsh-coding-remote-kit`](https://github.com/lninghaha/dsh-coding-remote-kit) | nome anterior do checkout `dsh-mobile-remote` |
| id do plugin Cordis | `mobile-remote` | inalterado |
| HTTP da página de configurações | `/api/mobile-remote/*` | inalterado |
| Armazenamento | `$DSH_HOME/storages/mobile-remote/` | inalterado |

**Não** execute `dsh plugin add dsh-mobile-remote` — isso instala o plugin WeChat não relacionado.

## Status

| Marco | Status |
| --- | --- |
| Pesquisa (Orca / ecossistema DSH) | concluído — [`docs/research/`](docs/research/) |
| M1 esqueleto do plugin + ADR / modelo de ameaça | concluído |
| M2 emparelhamento / plano de dados LAN | concluído |
| M3 RPC restrito / aprovações | concluído |
| M4 HTTPS assinado / app nativo | não iniciado |
| M5 Worker de rendezvous auto-hospedado | concluído — [`docs/05-cloud-relay.md`](docs/05-cloud-relay.md) |

## Recursos

- **UI bilíngue** — chinês e inglês nas Configurações do desktop e no companion do telefone (`?lang=` / alternância no app; padrão via `navigator.language`).
- **Emparelhe uma vez** — o desktop mostra um QR code ou PIN de 8 dígitos; o celular fixa a chave pública X25519 do desktop e guarda um `deviceToken` (o servidor armazena só o SHA-256).
- **Plano duplo** — as rotas de gestão ficam no `dsh web` em loopback; o plano de dados móvel é uma porta dedicada (padrão `6879`) com uma allowlist de RPC.
- **E2EE após o handshake** — tweetnacl secretbox em `/m/ws`; sockets não autenticados nunca veem o conteúdo da sessão.
- **Escritas restritas** — observar sessões, responder aprovações/perguntas, respostas curtas; edição pesada fica no desktop.
- **Rede privada primeiro** — LAN / Tailscale preferidos. O Cloudflare Quick Tunnel opcional expõe **somente** o plano de dados, nunca a porta `3080`. Worker de rendezvous auto-hospedado opcional: desktop e celular saem outbound; os frames de negócio continuam E2EE.
- **Forma padrão de plugin** — um plugin Cordis de servidor + página de configurações classic-script. `dsh plugin --profile web add` com um **file tarball**, nunca uma árvore de trabalho `link:`.

## Capturas de tela

<p align="center">
  <img src="docs/assets/en/settings-pairing.png" alt="Configurações do desktop — oferta de pareamento com QR e PIN" width="48%" />
  &nbsp;
  <img src="docs/assets/en/settings-overview.png" alt="Configurações do desktop — status do canal e dispositivos pareados" width="48%" />
</p>
<p align="center"><em>Desktop Settings → Mobile Remote: criar oferta de pareamento (esquerda) · status do canal e dispositivos (direita)</em></p>

<p align="center">
  <img src="docs/assets/en/mobile-pair.png" alt="Tela de pareamento no telefone" width="28%" />
  &nbsp;&nbsp;
  <img src="docs/assets/en/mobile-sessions.png" alt="Lista de sessões no telefone" width="28%" />
</p>
<p align="center"><em>Companion no telefone: digitar PIN / escanear (esquerda) · lista de sessões após o pareamento (direita)</em></p>

## Problemas que este plugin resolve

| Você buscou / viu | O que realmente estava quebrado | O que este plugin faz |
|---|---|---|
| “companion de celular estilo Orca para DSH” | O DSH oficial não tem um app móvel emparelhado de primeira classe | Companion semântico: emparelhamento + E2EE + RPC em allowlist |
| `dsh-pocket` / `dsh-web-remote` no celular | Superfície completa do `dsh web` na LAN/pública | Plano duplo; métodos RPC desconhecidos são `forbidden` |
| Celular na rede móvel, desktop na LAN | Página HTTP LAN crua pode sofrer MITM | Prefira Tailscale; Quick Tunnel opcional (TLS na borda, origem localhost) |
| `import` do plugin falhou e a porta 3080 caiu | O DSH faz fail-fast da árvore inteira de plugins | Gate de sandbox + tarball copiado *fora* do repo; sem `link:` |

## Início rápido

```bash
dsh plugin --profile web add dsh-coding-remote-kit@0.5.0
```

Depois o **operador** reinicia o processo `dsh web` existente na própria janela. Abra **Settings → 移動远程**, crie uma oferta de emparelhamento, escaneie o QR (ou digite o PIN) no celular.

A partir de um checkout de código (desenvolvimento):

```bash
pnpm test:sandbox
pnpm pack
mkdir -p "$HOME/.dsh/packages"
cp dsh-coding-remote-kit-0.5.0.tgz "$HOME/.dsh/packages/"
dsh plugin --profile web add "$HOME/.dsh/packages/dsh-coding-remote-kit-0.5.0.tgz"
```

Não execute `dsh plugin add ./` nesta árvore de trabalho. O pnpm 11 trata alguns caminhos `file:` de tarball como fonte `link:`, e um import de entrada ruim derruba a GUI inteira.

## Sumário

- [Nomes](#nomes)
- [Status](#status)
- [Recursos](#recursos)
- [Capturas de tela](#capturas-de-tela)
- [Problemas que este plugin resolve](#problemas-que-este-plugin-resolve)
- [Início rápido](#início-rápido)
- [Instalação](#instalação)
- [Como funciona](#como-funciona)
- [Página de configurações](#página-de-configurações)
- [RPC móvel](#rpc-móvel)
- [Túnel público](#túnel-público)
- [Segurança](#segurança)
- [Arquitetura](#arquitetura)
- [Documentação](#documentação)
- [Relacionado](#relacionado)
- [Contribuindo](#contribuindo)
- [Licença](#licença)

## Instalação

Requer DeepSeek Harness `0.1.0-rc.6` (fixado) e Node.js 22.19+. Passos completos, emparelhamento e notas de túnel: [INSTALL.md](INSTALL.md).

Desenvolvimento:

```bash
pnpm install && pnpm build && pnpm test   # inside the Docker sandbox, not on a live GUI host
pnpm test:sandbox                         # Dockerfile targets check / isolated-install / verify
```

Saídas da build:

- `lib/server/index.js` — entrada Cordis (`name` / `inject` / `Config` / `apply`)
- `lib/client.js` — classic-script da página de configurações
- `lib/mobile/` — página do celular servida em `/m`

## Como funciona

```text
Settings (loopback)          Phone browser
        │                            │
        │  QR / PIN  ────────────────┤
        ▼                            ▼
 /api/mobile-remote/*          GET /m  +  WS /m/ws
   (dsh web, :3080)            (data plane, :6879, E2EE)
```

A gestão permanece atrás da cerca de loopback do Web do host. O plano de dados é um servidor separado `node:http` + `ws`. O emparelhamento pode religá-lo de `127.0.0.1` para `0.0.0.0` para clientes LAN; um Quick Tunnel ativo anuncia a origem HTTPS em vez de alargar o bind.

## Página de configurações

Abra **Settings → 移動远程**:

- status (bind, porta, escutando, dispositivos ativos, túnel, rendezvous)
- canais **LAN** / **Quick Tunnel** / **rendezvous**
- criar oferta → QR + PIN de 8 dígitos
- lista de dispositivos e revogação
- instalação opcional do `cloudflared` oficial (nunca roda no `apply()` do plugin)

## RPC móvel

Métodos na allowlist (todo o resto é `forbidden`):

`status.get` · `session.list` · `session.history` · `session.subscribe` · `session.unsubscribe` · `host.subscribe` · `session.prompt` · `session.cancel` · `session.create` · `respond`

Os pushes incluem eventos de sessão mais `approval.requested` / `question.requested` (com `rpcId` para `respond`). Formato de fio: [docs/03-protocol.md](docs/03-protocol.md).

## Túnel público

Padrão **desligado**. Quando iniciado nas Configurações, o Quick Tunnel `cloudflared` aponta **somente** para `127.0.0.1:<data-plane-port>`. `/m` fica acessível em uma URL `https://<random>.trycloudflare.com`; o emparelhamento ainda precisa do token de fragmento (ou PIN) e E2EE. O processo filho é morto no unload / Stop do plugin.

Nunca faça túnel da porta `3080` / `dsh web`. Um Worker de rendezvous auto-hospedado (desktop e celular ambos outbound, frames de negócio ainda E2EE) é opcional; veja [docs/05-cloud-relay.md](docs/05-cloud-relay.md). Precisa de um plano Cloudflare Workers Paid e **não** é um relay público operado por este projeto.

## Segurança

Invariantes (modelo completo: [docs/04-threat-model.md](docs/04-threat-model.md)):

1. Conexões não autenticadas tratam só o handshake.
2. `deviceToken` é armazenado como SHA-256; chaves e arquivos de registro são `0600`.
3. Allowlist de RPC, negação padrão; escritas são auditadas para `deviceId`.
4. O plano de gestão é loopback + Host + CSRF.
5. O plugin não enfraquece o `/api` do `dsh web` e não assume provedores `api-proxy`.

**Limite honesto do v0:** o primeiro download HTTP de `/m` em uma LAN crua pode sofrer MITM. Prefira uma VPN overlay.

Proibições:

- Não compartilhe credenciais de outra pessoa.
- Não monitore contas sem autorização.
- Não ligue a porta do plano de dados em `0.0.0.0` à Internet pública (Quick Tunnel iniciado explicitamente pelo usuário é a exceção).
- Não implique endosso oficial da DeepSeek.

Os exemplos na documentação usam apenas `example.com`, `127.0.0.1` e `YOUR_TOKEN`.

## Arquitetura

Plano duplo, mapa de módulos, armazenamento e handshake: [docs/02-architecture.md](docs/02-architecture.md) · [中文](docs/02-architecture.zh-CN.md).

Decisão do MVP (rota B): [docs/01-mvp-scope.md](docs/01-mvp-scope.md).

## Documentação

| Doc | Propósito |
|---|---|
| [INSTALL.md](INSTALL.md) | Instalar, emparelhar, túnel |
| [CHANGELOG.md](CHANGELOG.md) | Histórico de releases |
| [docs/00-project-rules.md](docs/00-project-rules.md) | Versionamento, publicar vs só local, limite do DSH hospedeiro |
| [docs/01-mvp-scope.md](docs/01-mvp-scope.md) | ADR: escopo do MVP (chinês) |
| [docs/02-architecture.md](docs/02-architecture.md) | Arquitetura interna · [中文](docs/02-architecture.zh-CN.md) |
| [docs/03-protocol.md](docs/03-protocol.md) | Allowlist RPC e envelopes de push (chinês) |
| [docs/04-threat-model.md](docs/04-threat-model.md) | Ativos, atacantes, invariantes (chinês) |
| [docs/05-cloud-relay.md](docs/05-cloud-relay.md) | Worker de rendezvous auto-hospedado (M5) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Guia de contribuição |
| [AGENTS.md](AGENTS.md) | Regras de agent/operador (sem restart de produção) |

## Relacionado

- [dsh-coding-subscription-oauth](https://github.com/lninghaha/dsh-coding-subscription-oauth) — plugin irmão; o layout da documentação é modelado nele.
- GitHub: [`lninghaha/dsh-coding-remote-kit`](https://github.com/lninghaha/dsh-coding-remote-kit).
- Este plugin é independente do plugin de centro de uso `dsh-hub-oauth-gateway`.
- Não substitui `@deepseek-ai/dsh`.

## Contribuindo

Issues e PRs são bem-vindos. Veja [CONTRIBUTING.md](CONTRIBUTING.md) para o sandbox Docker, convenções de commit e as camadas de documentos.

## Licença

[MIT](LICENSE).
