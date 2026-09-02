# 02 · 架构设计

> 中文版 · [**English**](02-architecture.md)

本文描述 `dsh-coding-remote-kit` 的内部架构，是 `README.md` 技术说明的来源，面向贡献者与维护者。

宿主钉死：`@deepseek-ai/dsh@0.1.1-rc.2`。升级需另开 ADR（`docs/01-mvp-scope.md`）。`0.1.2-alpha` 仍是未验证候选。

## 1. 双平面

```text
Harness webServer（回环，通常 127.0.0.1:3080）
  └─ 管理面 /api/mobile-remote/*
       配对 offer、设备列表、吊销、隧道 / 会合中继开关
       OwnerRequestPolicy：loopback/SSH 或完整受信 HTTPS 反代证明

独立数据面（默认 127.0.0.1:6879，配对时可 widen 到 0.0.0.0）
  ├─ GET  /m, /m/*     手机静态页（no-store；CSP + `frame-ancestors 'none'`）
  ├─ POST /m/claim     配对 PIN → offer（有速率限制）
  └─ WS   /m/ws        E2EE 握手 + 白名单 RPC
```

本插件**不**反向代理 `dsh web`，也**不**抢宿主 `api-proxy` 的审批/提问 provider。会话观察与写操作走数据面的窄 RPC 白名单。

MVP 路线：**B — 语义窄 RPC + 双平面**（`docs/01-mvp-scope.md`）。路线 A（完整 Web 透传）已拒绝。路线 C（签名原生 App）延后。

## 2. 主机数据流

```text
设置页（src/client）
  └─ slots.register「移动远程」
       GET  /api/mobile-remote/status
       POST /api/mobile-remote/offers     → widen 或广告隧道 + 二维码 / PIN
       GET  /api/mobile-remote/devices
       POST /api/mobile-remote/revoke
       GET/POST /api/mobile-remote/tunnel
       GET/POST /api/mobile-remote/relay
       POST /api/mobile-remote/cloudflared

手机浏览器 /m（src/mobile）
  └─ location.hash fragment（配对 offer）或 POST /m/claim { code }
       └─ 手机侧 X25519 密钥
            └─ WebSocket /m/ws
                 e2ee_hello → transcript → session keys（secretbox）
                      └─ status.get → session.list / subscribe / respond / prompt

src/server
  ├─ DeviceRegistry     devices.json（只存 token 的 SHA-256）
  ├─ OfferRegistry      内存中的待配对 offer
  ├─ AuditLogger        audit.jsonl（method + id，无 payload）
  ├─ server-key.json    X25519 身份（0600）
  ├─ MobileDataPlane    HTTP + ws
  ├─ CloudflareQuickTunnel   只暴露数据面（永不 3080）
  ├─ RendezvousClient   出站 WSS 连自建 Worker（永不 3080）
  └─ UpstreamHub        apiProxy 会话 / 审批 / 提问
```

未认证的 WebSocket **只处理握手**。业务 RPC 在 `e2ee_auth` 之后才开始。

## 3. 模块职责

### `src/index.ts`

从 `src/server/index.ts` 再导出 Cordis 的 `name` / `inject` / `Config` / `apply`。

### `src/server/`

- `index.ts`：插件 `apply`。存储、服务端密钥、数据面监听、管理面路由、隧道与会合中继 disposer。
- `config.ts`：Zod：`enabled` / `bind` / `port` / `offerTtlMs` / fail-closed `ownerRequest`；旧 `trustedHosts` 不再授予访问权限。
- `context.ts`：宿主 `apiProxy` + `webServer` 类型。
- `routes.ts`：每个 path 只 `webServer.register` 一次（DSH 按 path 去重、不认 HTTP method）。GET/POST 在 handler 内分支。
- `security.ts`：宿主 owner policy 优先；fallback 校验 loopback/SSH 或受信 HTTPS peer + Origin/Host + owner proof + Fetch Metadata + 独立 CSRF，并提供有界 JSON body。宿主策略异常或畸形时 fail closed。
- `dataplane.ts`：数据面端口上的独立 `node:http` + `ws`；静态 `/m`；`/m/claim`；`/m/ws`。
- `connection.ts`：`acceptMobileSocket` — `/m/ws` 与会合中继 accept 共用的 E2EE + RPC 会话。
- `e2ee.ts` / `crypto.ts`：服务端握手、token 查找、tweetnacl secretbox。
- `rpc.ts`：白名单分发；未知方法 → `forbidden`。
- `upstream.ts`：宿主 `apiProxy` 会话/审批/提问桥。
- `registry.ts`：设备、内存 offer、JSONL 审计。
- `keys.ts` / `storage.ts`：`$DSH_HOME/storages/mobile-remote/`（目录 0700、文件 0600、原子写）。
- `net.ts`：二维码广告用的 LAN 候选地址。
- `backpressure.ts`：每连接出站队列上限。
- `tunnel.ts`：Cloudflare Quick Tunnel 子进程；持久化 `tunnel.json`；unload 时杀掉。
- `relay.ts`：出站会合客户端（`dshmr-relay/v1`）；持久化 `relay.json`；unload 时停止。禁止夹进 `cloudflared`。
- `cloudflared-install.ts`：可选官方二进制安装（禁止在 `apply()` 时跑）。

### `src/shared/`

无依赖的协议常量与编解码，Node 与手机页共用：`constants.ts`（RPC 白名单、帧长度、HKDF 标签）、`offer.ts`、`pair-code.ts`、`handshake.ts`、`frame.ts`、`hkdf.ts`、`transcript.ts`、`validation.ts`、`base64.ts`、`version.ts`、`relay.ts`（会合外层信封）。

### `src/client/`

classic-script 设置页（`window.__ModuleLoader__.load`）。二维码、8 位 PIN、设备列表、LAN / Quick Tunnel / 会合中继。注入 `@deepseek-ai/dsh-client-ui-settings` 与 `dsh-client-ui-slots`。

### `src/mobile/`

手机浏览器页，构建到 `lib/mobile/`。`main.ts` 读 fragment offer、保持一条 WebSocket、跑四步握手。`app.ts` 渲染会话列表 / transcript / 短回复 / 审批与提问卡片。`sw.js` 只缓存 `/m` 静态壳。

## 4. HTTP / WebSocket API

管理面（宿主 `webServer`，仅回环）：

```text
POST /api/mobile-remote/offers
GET  /api/mobile-remote/status
GET  /api/mobile-remote/devices          # 永不包含 tokenHash
POST /api/mobile-remote/revoke           # { deviceId }
GET  /api/mobile-remote/tunnel
POST /api/mobile-remote/tunnel           # { kind: "cloudflare-quick", action: "start"|"stop" }
GET  /api/mobile-remote/relay
POST /api/mobile-remote/relay            # { action: "start"|"stop", origin?, hostToken? }
POST /api/mobile-remote/cloudflared      # { action: "install" }
```

写请求 JSON 有界。响应只有状态、offer 元数据、二维码文本和非秘密过期时间——从不返回 `deviceToken` 或服务端私钥。

数据面（默认端口 6879）：

```text
GET  /m  → 302 /m/
GET  /m/*                 手机静态资源，no-store
POST /m/claim             { code } → { offer }   # 8 位 PIN；每 IP 每分钟最多 8 次失败
WS   /m/ws                E2EE + RPC
```

RPC 方法与推送信封见 `docs/03-protocol.md`。

## 5. 存储

`$DSH_HOME/storages/mobile-remote/`（`$DSH_HOME` 默认 `~/.dsh`）：

| 文件 | 作用 |
|---|---|
| `server-key.json` | X25519 身份；0600；首次启动生成 |
| `devices.json` | 已配对设备；**只存 deviceToken 的 SHA-256** |
| `audit.jsonl` | `rpc_write` / offer / 吊销 / 隧道事件；无 payload |
| `tunnel.json` | Quick Tunnel 持久化，崩溃后可回收残留子进程 |
| `relay.json` | 会合 origin / hostId / hostToken（0600）；GET 永不返回 token |

## 6. 配对与 E2EE

1. 桌面创建配对 offer（endpoint、页面 URL、服务端公钥、TTL）。
2. 手机打开 `/m#<offer>`（二维码）或把 8 位 PIN POST 到 `/m/claim`。
3. 手机生成自己的 X25519 密钥并连接 `/m/ws`。
4. 四步握手（`dshmr-e2ee/v1`）钉死桌面公钥，经 HKDF 派生会话密钥，再用 device token 做 `e2ee_auth`。
5. 之后的帧走 tweetnacl secretbox。连续 5 次解密失败关闭连接。

密码学库替换**延期**（本里程碑继续用 tweetnacl，直至 E2EE 版本升级）：见 [`docs/research/adr-tweetnacl-vs-libsodium-webcrypto.md`](research/adr-tweetnacl-vs-libsodium-webcrypto.md)。除设置页吊销 / 空闲自动吊销外的 deviceToken 轮换**本版不做**：见 [`docs/research/adr-device-key-rotation.md`](research/adr-device-key-rotation.md)。

v0 诚实边界：裸 LAN 上 **`/m` 的首次 HTTP 下发**可被 MITM。页面被替换后，E2EE 只保护「恶意脚本与服务器之间」的信道。推荐 Tailscale / WireGuard；可选 Cloudflare Quick Tunnel 在边缘终结 TLS，且**不得**把 3080 送进隧道。可选自建会合中继（M5）用 HTTPS 提供 `/m` 并拼接出站 WebSocket，也**不得**看见 3080。细节见 `docs/04-threat-model.md`、`docs/05-cloud-relay.md`。

## 7. 构建产物

| 产物 | 作用 |
|---|---|
| `lib/server/index.js` | 打包后的 Cordis 入口（`packages: "external"` — 不要把 `tweetnacl` 打进 ESM） |
| `lib/client.js` | 设置页 classic-script |
| `lib/mobile/` | 手机页 + service worker |
| `lib/**` 转译树 | 仅供单元测试 import |

`package.json` `exports` 必须包含 `"."`、`"./client"` 和 `"./package.json"`（DSH 用 `require.resolve("<pkg>/package.json")` 扫描客户端模块）。

## 8. 兼容性

- Cordis 插件 id：`mobile-remote`。
- 配置默认：`enabled: true`，`bind: "127.0.0.1"`，`port: 6879`。
- 配对广告 LAN 候选且没有公网隧道 / 会合中继时，数据面会 widen 到 `0.0.0.0`。
- 线协议版本：`MOBILE_PROTOCOL_VERSION = 1`（`src/shared/constants.ts`）。
