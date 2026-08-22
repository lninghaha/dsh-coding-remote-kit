<!-- banner -->
<div align="center">

# dsh-coding-remote-kit

**v0.4.0** · DeepSeek Harness `0.1.0-rc.6` · GitHub `dsh-coding-remote-kit`

**Acceso remoto por teléfono a [DeepSeek Harness](https://github.com/deepseek-ai/dsh).** Empareja un teléfono con el escritorio que ya ejecuta `dsh web`, observa sesiones y realiza un conjunto limitado de escrituras — sin exponer la API Web completa.

[![npm](https://img.shields.io/npm/v/dsh-coding-remote-kit.svg)](https://www.npmjs.com/package/dsh-coding-remote-kit)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

*[English](README.md) · [中文版](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Português (BR)](README.pt-BR.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)*

</div>

---

> **Upgrade / 升级：** Follow the versioned steps in [`INSTALL.md`](INSTALL.md). Install into the existing `web` profile, keep profile/config/credential files, and restart one existing DSH Web process after all packages are updated. When Hub and Subscription are both used, `dsh-coding-oauth-core@0.1.0` is their shared npm dependency, not a separate DSH plugin.

---

Plugin de la comunidad. **No está afiliado ni respaldado por DeepSeek.** La intención del producto está más cerca de [Orca Mobile Companion](https://www.onorca.dev/docs/mobile) que de una segunda copia del IDE de escritorio.

Lee [`AGENTS.md`](AGENTS.md) antes de cambiar este repositorio: **no reinicies tú mismo el `dsh-web` de producción.** Prepara el tarball; el operador reinicia.

## Nombres

Se desarrolló primero como GitHub `dsh-mobile-remote`. El nombre npm **`dsh-mobile-remote` es otro proyecto** (plugin de control remoto WeChat). Este plugin se publica como `dsh-coding-remote-kit`.

| | Usa esto | Notas |
|---|---|---|
| npm | `dsh-coding-remote-kit@0.4.0` | `dsh plugin --profile web add dsh-coding-remote-kit@0.4.0` |
| GitHub | [`lninghaha/dsh-coding-remote-kit`](https://github.com/lninghaha/dsh-coding-remote-kit) | nombre anterior del checkout `dsh-mobile-remote` |
| id del plugin Cordis | `mobile-remote` | sin cambios |
| HTTP de la página de ajustes | `/api/mobile-remote/*` | sin cambios |
| Almacenamiento | `$DSH_HOME/storages/mobile-remote/` | sin cambios |

**No** ejecutes `dsh plugin add dsh-mobile-remote` — instala el plugin WeChat no relacionado.

## Estado

| Hito | Estado |
| --- | --- |
| Investigación (Orca / ecosistema DSH) | hecho — [`docs/research/`](docs/research/) |
| M1 esqueleto del plugin + ADR / modelo de amenazas | hecho |
| M2 emparejamiento / plano de datos LAN | hecho |
| M3 RPC restringido / aprobaciones | hecho |
| M4 HTTPS firmado / app nativa | no iniciado |
| M5 Worker de rendezvous autohospedado | hecho — [`docs/05-cloud-relay.md`](docs/05-cloud-relay.md) |

## Características

- **IU bilingüe** — chino e inglés en Ajustes del escritorio y el companion del teléfono (`?lang=` / cambio en la app; por defecto `navigator.language`).
- **Empareja una vez** — el escritorio muestra un código QR o un PIN de 8 dígitos; el teléfono fija la clave pública X25519 del escritorio y guarda un `deviceToken` (el servidor almacena solo el SHA-256).
- **Plano dual** — las rutas de gestión se quedan en el `dsh web` de loopback; el plano de datos móvil es un puerto dedicado (por defecto `6879`) con una lista de RPC permitidos.
- **E2EE tras el handshake** — tweetnacl secretbox en `/m/ws`; los sockets no autenticados nunca ven el contenido de la sesión.
- **Escrituras estrechas** — observar sesiones, responder aprobaciones/preguntas, respuestas cortas; la edición pesada se queda en el escritorio.
- **Red privada primero** — se prefiere LAN / Tailscale. El Cloudflare Quick Tunnel opcional expone **solo** el plano de datos, nunca el puerto `3080`. Worker de rendezvous autohospedado opcional: escritorio y teléfono salen outbound; los frames de negocio siguen en E2EE.
- **Forma estándar de plugin** — un plugin Cordis de servidor + página de ajustes classic-script. `dsh plugin --profile web add` con un **file tarball**, nunca un árbol de trabajo `link:`.

## Capturas de pantalla

<p align="center">
  <img src="docs/assets/en/settings-pairing.png" alt="Ajustes de escritorio — oferta de emparejamiento con QR y PIN" width="48%" />
  &nbsp;
  <img src="docs/assets/en/settings-overview.png" alt="Ajustes de escritorio — estado del canal y dispositivos emparejados" width="48%" />
</p>
<p align="center"><em>Escritorio Settings → Mobile Remote: crear oferta de emparejamiento (izquierda) · estado del canal y dispositivos (derecha)</em></p>

<p align="center">
  <img src="docs/assets/en/mobile-pair.png" alt="Pantalla de emparejamiento en el teléfono" width="28%" />
  &nbsp;&nbsp;
  <img src="docs/assets/en/mobile-sessions.png" alt="Lista de sesiones en el teléfono" width="28%" />
</p>
<p align="center"><em>Companion en el teléfono: introducir PIN / escanear (izquierda) · lista de sesiones tras el emparejamiento (derecha)</em></p>

## Problemas que resuelve este plugin

| Buscaste / viste | Qué estaba realmente roto | Qué hace este plugin |
|---|---|---|
| “companion de teléfono estilo Orca para DSH” | El DSH oficial no tiene una app móvil emparejada de primera clase | Companion semántico: emparejamiento + E2EE + RPC en allowlist |
| `dsh-pocket` / `dsh-web-remote` en el teléfono | Superficie completa de `dsh web` en LAN/pública | Plano dual; los métodos RPC desconocidos son `forbidden` |
| Teléfono en red móvil, escritorio en LAN | Una página HTTP LAN cruda puede sufrir MITM | Prefiere Tailscale; Quick Tunnel opcional (TLS en el borde, origen localhost) |
| El `import` del plugin falló y el puerto 3080 murió | DSH hace fail-fast de todo el árbol de plugins | Puerta de sandbox + tarball copiado *fuera* del repo; sin `link:` |

## Inicio rápido

```bash
dsh plugin --profile web add dsh-coding-remote-kit@0.4.0
```

Después el **operador** reinicia el proceso `dsh web` existente en su propia ventana. Abre **Settings → 移動远程**, crea una oferta de emparejamiento, escanea el QR (o escribe el PIN) en el teléfono.

Desde un checkout de código (desarrollo):

```bash
pnpm test:sandbox
pnpm pack
mkdir -p "$HOME/.dsh/packages"
cp dsh-coding-remote-kit-0.4.0.tgz "$HOME/.dsh/packages/"
dsh plugin --profile web add "$HOME/.dsh/packages/dsh-coding-remote-kit-0.4.0.tgz"
```

No ejecutes `dsh plugin add ./` en este árbol de trabajo. pnpm 11 trata algunas rutas `file:` de tarball como fuente `link:`, y un import de entrada fallido tumba toda la GUI.

## Tabla de contenidos

- [Nombres](#nombres)
- [Estado](#estado)
- [Características](#características)
- [Capturas de pantalla](#capturas-de-pantalla)
- [Problemas que resuelve este plugin](#problemas-que-resuelve-este-plugin)
- [Inicio rápido](#inicio-rápido)
- [Instalación](#instalación)
- [Cómo funciona](#cómo-funciona)
- [Página de ajustes](#página-de-ajustes)
- [RPC móvil](#rpc-móvil)
- [Túnel público](#túnel-público)
- [Seguridad](#seguridad)
- [Arquitectura](#arquitectura)
- [Documentación](#documentación)
- [Relacionado](#relacionado)
- [Contribuir](#contribuir)
- [Licencia](#licencia)

## Instalación

Requiere DeepSeek Harness `0.1.0-rc.6` (fijado) y Node.js 22.19+. Pasos completos, emparejamiento y notas de túnel: [INSTALL.md](INSTALL.md).

Desarrollo:

```bash
pnpm install && pnpm build && pnpm test   # inside the Docker sandbox, not on a live GUI host
pnpm test:sandbox                         # Dockerfile targets check / isolated-install / verify
```

Salidas de la build:

- `lib/server/index.js` — entrada Cordis (`name` / `inject` / `Config` / `apply`)
- `lib/client.js` — classic-script de la página de ajustes
- `lib/mobile/` — página del teléfono servida en `/m`

## Cómo funciona

```text
Settings (loopback)          Phone browser
        │                            │
        │  QR / PIN  ────────────────┤
        ▼                            ▼
 /api/mobile-remote/*          GET /m  +  WS /m/ws
   (dsh web, :3080)            (data plane, :6879, E2EE)
```

La gestión se queda detrás de la valla de loopback del Web del host. El plano de datos es un servidor separado `node:http` + `ws`. El emparejamiento puede volver a enlazarlo de `127.0.0.1` a `0.0.0.0` para clientes LAN; un Quick Tunnel activo anuncia su origen HTTPS en lugar de ensanchar el bind.

## Página de ajustes

Abre **Settings → 移動远程**:

- estado (bind, puerto, escuchando, dispositivos activos, túnel, rendezvous)
- canales **LAN** / **Quick Tunnel** / **rendezvous**
- crear oferta → QR + PIN de 8 dígitos
- lista de dispositivos y revocación
- instalación opcional del `cloudflared` oficial (nunca se ejecuta en el `apply()` del plugin)

## RPC móvil

Métodos en la allowlist (todo lo demás es `forbidden`):

`status.get` · `session.list` · `session.history` · `session.subscribe` · `session.unsubscribe` · `host.subscribe` · `session.prompt` · `session.cancel` · `session.create` · `respond`

Los pushes incluyen eventos de sesión más `approval.requested` / `question.requested` (con `rpcId` para `respond`). Formato de cable: [docs/03-protocol.md](docs/03-protocol.md).

## Túnel público

Por defecto **apagado**. Cuando se inicia desde Ajustes, el Quick Tunnel de `cloudflared` apunta **solo** a `127.0.0.1:<data-plane-port>`. `/m` queda alcanzable en una URL `https://<random>.trycloudflare.com`; el emparejamiento sigue necesitando el token de fragmento (o PIN) y E2EE. El proceso hijo se mata al unload / Stop del plugin.

Nunca hagas túnel del puerto `3080` / `dsh web`. Un Worker de rendezvous autohospedado (escritorio y teléfono ambos outbound, frames de negocio aún E2EE) es opcional; ver [docs/05-cloud-relay.md](docs/05-cloud-relay.md). Necesita un plan Cloudflare Workers Paid y **no** es un relé público operado por este proyecto.

## Seguridad

Invariantes (modelo completo: [docs/04-threat-model.md](docs/04-threat-model.md)):

1. Las conexiones no autenticadas solo manejan el handshake.
2. `deviceToken` se almacena como SHA-256; las claves y los archivos de registro son `0600`.
3. Allowlist de RPC, denegación por defecto; las escrituras se auditan a `deviceId`.
4. El plano de gestión es loopback + Host + CSRF.
5. El plugin no debilita `/api` de `dsh web` y no toma proveedores `api-proxy`.

**Límite honesto de v0:** la primera descarga HTTP de `/m` en una LAN cruda puede sufrir MITM. Prefiere una VPN overlay.

Prohibiciones:

- No compartas credenciales de otra persona.
- No supervises cuentas sin autorización.
- No enlaces el puerto del plano de datos en `0.0.0.0` a Internet pública (el Quick Tunnel iniciado explícitamente por el usuario es la excepción).
- No impliques respaldo oficial de DeepSeek.

Los ejemplos de la documentación usan solo `example.com`, `127.0.0.1` y `YOUR_TOKEN`.

## Arquitectura

Plano dual, mapa de módulos, almacenamiento y handshake: [docs/02-architecture.md](docs/02-architecture.md) · [中文](docs/02-architecture.zh-CN.md).

Decisión del MVP (ruta B): [docs/01-mvp-scope.md](docs/01-mvp-scope.md).

## Documentación

| Doc | Propósito |
|---|---|
| [INSTALL.md](INSTALL.md) | Instalar, emparejar, túnel |
| [CHANGELOG.md](CHANGELOG.md) | Historial de versiones |
| [docs/00-project-rules.md](docs/00-project-rules.md) | Versionado, publicar vs solo local, límite del DSH anfitrión |
| [docs/01-mvp-scope.md](docs/01-mvp-scope.md) | ADR: alcance del MVP (chino) |
| [docs/02-architecture.md](docs/02-architecture.md) | Arquitectura interna · [中文](docs/02-architecture.zh-CN.md) |
| [docs/03-protocol.md](docs/03-protocol.md) | Allowlist RPC y sobres de push (chino) |
| [docs/04-threat-model.md](docs/04-threat-model.md) | Activos, atacantes, invariantes (chino) |
| [docs/05-cloud-relay.md](docs/05-cloud-relay.md) | Worker de rendezvous autohospedado (M5) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Guía de contribución |
| [AGENTS.md](AGENTS.md) | Reglas de agent/operador (sin reinicio de producción) |

## Relacionado

- [dsh-coding-subscription-oauth](https://github.com/lninghaha/dsh-coding-subscription-oauth) — plugin hermano; el diseño de la documentación está modelado en él.
- GitHub: [`lninghaha/dsh-coding-remote-kit`](https://github.com/lninghaha/dsh-coding-remote-kit).
- Este plugin es independiente del plugin de centro de uso `dsh-hub-oauth-gateway`.
- No sustituye a `@deepseek-ai/dsh`.

## Contribuir

Issues y PRs son bienvenidos. Consulta [CONTRIBUTING.md](CONTRIBUTING.md) para el sandbox Docker, las convenciones de commit y las capas de documentos.

## Licencia

[MIT](LICENSE).
