# 05 · 自建会合中继（方案 2）

状态：**已实现（M5）**。方案 1（Cloudflare Quick Tunnel，只暴露数据面 6879）仍在；本方案是第三条通道——桌面与手机各自**出站**连到操作者自己部署的 Cloudflare Worker，本机不必把 `6879` 打到公网。

社区插件。**不**运营公共会合点，**不**暗示 DeepSeek 或 Cloudflare 官方背书。部署与密钥由操作者自己的 Cloudflare 账号承担。Durable Objects 需要 **Workers Paid**。

## 动机

- 手机在 4G、未装 Tailscale，又**不想**把本机端口 Funnel / Quick Tunnel 打到公网。
- 中继只做桌面与手机的会合；业务帧仍走现有 X25519 + secretbox（`dshmr-e2ee/v1`），中继不可读会话明文。
- 配对链接指向 Worker 上的 HTTPS 页 + fragment 令牌，不包含内网 IP。

## 非目标

- 维护者运营的公共 cell / 账号体系
- 微信 / 飞书 Bot Channel
- 用反向代理把 GUI 同源路径挂成 `/m`（与 `dsh web` 混权）
- 把 `3080` / `dsh web` 送进 Worker
- WebRTC / TURN
- 在插件 `apply()` 里部署 Worker 或调用 Cloudflare API
- 改 E2EE、放宽 RPC 白名单
- 多桌面精细 ACL（v1 = 单 `HOST_TOKEN`）

## 通道怎么选

| 通道 | 本机入站 | 账号 | `/m` 投递 |
|---|---|---|---|
| 局域网 | 数据面 widen 到 `0.0.0.0` | 无 | 裸 HTTP（MITM 边界见威胁模型） |
| Quick Tunnel（方案 1） | `cloudflared` 把 `127.0.0.1:6879` 打到 `trycloudflare.com` | 无 CF 账号 | 边缘 TLS；URL 即临时钥匙 |
| **会合中继（方案 2）** | **无**（桌面只出站） | 自建 Worker + Paid | 边缘 TLS；静态页由 Worker 提供 |

三通道互斥。中继运行时**禁止** `widen()`，也**禁止**拉起 `cloudflared`。

## 架构

```text
设置页（回环 3080）
  POST /api/mobile-remote/relay { action: start, origin, hostToken }
        │
        ▼
桌面插件（出站）
  WSS  /v1/host             控制面（invite / claim / accept 通知）
  WSS  /v1/accept/:ticket   每部手机一条；接上后当数据面 socket

Cloudflare Worker + Durable Object（id = hostId）
  GET  /m/*                 手机静态页（部署时嵌入 lib/mobile）
  POST /m/claim             把 PIN 转到桌面控制面，回 offer
  WSS  /v1/host
  WSS  /v1/phone/:hostId
  WSS  /v1/accept/:ticket
  GET  /health

手机
  https://<relay>/m/#<offer v1>     fragment 不到服务器
  wss://<relay>/v1/phone/<hostId>?invite=...
        │  DO 原样转发
        ▼
  桌面 accept socket → acceptMobileSocket()（e2ee_hello… → RPC）
```

数据面 `127.0.0.1:6879` 继续监听，供本机调试与 LAN 通道。Offer **保持 v1**（exact keys）；中继只写进 `pageUrl` / `endpoint`。`HANDSHAKE_CONTEXT.transport` 仍为 `"direct"`——中继是透明管道，不进入 E2EE transcript。

## 线协议（外层 `dshmr-relay/v1`）

只用于 Worker ↔ 桌面控制面。拼接之后的手机业务帧**不是**这种 JSON，Worker **禁止**解析。

控制面（JSON text）：

| 方向 | 消息 |
|---|---|
| 桌面 → Worker | `host_hello { v, hostId, hostToken }` |
| Worker → 桌面 | `host_ok { v, hostId }` / `host_error { error.code }` |
| 桌面 → Worker | `invite_put { invite, expiresAt, offerId }` |
| Worker → 桌面 | `invite_ack { offerId }` |
| Worker → 桌面 | `claim { requestId, code }` |
| 桌面 → Worker | `claim_result { requestId, offer?, error? }` |
| Worker → 桌面 | `phone_waiting { ticket, expiresAt }` |
| 双向 | `ping` / `pong` |

手机 URL：

- 配对：`wss://<origin>/v1/phone/<hostId>?invite=<token>`
- 重连：`wss://<origin>/v1/phone/<hostId>?resume=1`（Worker 只确认桌面在线；真鉴权仍是 `e2ee_auth`）

约束：

- `ticket` 32 字节、单次、15s
- 每 host 最多 8 条未完成拼接的 phone
- 帧长上限 1 MiB（与 `MAX_WS_PAYLOAD` 一致）
- Worker 日志不得包含帧、offer、`deviceToken`、invite、`hostToken`（claim 只记 `offerId` / 错误码）
- `hostToken` 用 SHA-256 后做恒定时间比较。同一 token 的第二个 `host_hello` **顶替**第一条（桌面重启）

## 管理面

```text
GET  /api/mobile-remote/relay     snapshot（永不返回 hostToken）
POST /api/mobile-remote/relay     { action: "start"|"stop", origin?, hostToken? }
```

`origin` 必须是 `https:`。缺凭证则读 `$DSH_HOME/storages/mobile-remote/relay.json`（0600）：`{ origin, hostId, hostToken }`。审计只记 host，不记 token / 查询串。

`GET /api/mobile-remote/status` 增加 `relay` 字段；`tunnel` 仍只描述 Quick Tunnel。

`POST /api/mobile-remote/offers`：若中继 `hostConnected`，广告 Worker origin 且不 widen；若 Quick Tunnel 在跑，行为与方案 1 相同；否则 LAN widen。

## 手机页

Worker 与数据面提供同一套 `/m` 静态资源（部署时从 `lib/mobile/` 拷入）。`PLUGIN_VERSION` 与桌面 `status.get` 不一致时页面提示重新部署 `relay/`。

握手成功后把完整 offer（含 `deviceToken`）写入 `localStorage`，刷新可 `resume=1` 重连。无 hash 时先尝试已存 offer，失败再 PIN 表单。`POST /m/claim` 用相对路径，在中继源上打到 Worker。

## 威胁模型摘要

完整表见 [`04-threat-model.md`](04-threat-model.md)。

| 谁 | 能看见 | 不能看见 |
|---|---|---|
| Worker 运营者（操作者自己的 CF 账号） | 谁在连、何时连、帧长/时间；**PIN 兑换时的完整 offer**（含 `deviceToken`） | QR fragment 里的 offer；`e2ee_auth` 之后的 RPC 明文 |
| 持有 `/m` URL 的路人 | 能加载静态页 | 无 invite / 无已存 offer 则过不了拼接或过不了 E2EE |
| LAN MITM | 中继路径上不再能替换首次 HTTP（边缘 TLS） | — |

自建中继 = 信任该 Cloudflare 账号与该 Worker 源码。被攻破的 Worker 可给手机下发恶意 JS（投递层）。这比签名原生 App 弱，比裸 LAN HTTP `/m` 强。

## 部署（操作者）

需要 Cloudflare 账号与 Workers Paid。示例域用 `example.com`。

```bash
pnpm build
cd relay
pnpm install
npx wrangler types
npx wrangler secret put HOST_TOKEN          # 粘贴与设置页相同的 YOUR_TOKEN
npx wrangler deploy                         # 或绑定自定义域 example.com
```

然后在 **设置 → 移动远程 → 会合中继** 填写 `https://example.com`（或 `https://<name>.workers.dev`）与同一 token，点连接后再生成二维码。

插件升级后必须重新 `pnpm build` 并 `wrangler deploy`，否则手机页与桌面协议可能不一致。

不要把 `HOST_TOKEN`、真实域名或账号写进 git。
