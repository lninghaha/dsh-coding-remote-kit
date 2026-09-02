# ADR 0001：MVP 范围与实现路线

- 状态：已接受
- 日期：2026-08-19
- 决策者：本仓库维护者
- 宿主版本：`@deepseek-ai/dsh@0.1.1-rc.2`（钉死；升级需另开 ADR）
- 修订：2026-09-02 将宿主钉从 `0.1.0-rc.6` 迁到已验证的 `0.1.1-rc.2`，并消除正文里误写的 `rc.7`。`0.1.2-alpha` 仍是未验证候选。

## 背景

三篇调研（见 [`docs/research/`](research/)）给出的事实：

- [`orca-mobile-connection.md`](research/orca-mobile-connection.md)：Orca Mobile Companion 是「桌面跑 Agent、手机做 companion」；信任锚是配对时交换的桌面公钥钉死 + `deviceToken`；可选 Relay 只做跨网 WSS，业务载荷走 E2EE。
- [`dsh-ecosystem-comparison.md`](research/dsh-ecosystem-comparison.md)：DSH 官方没有一等公民的配对手机 App；社区方案多为透传 `dsh web`（`dsh-pocket` / `dsh-web-remote`）或独立语义遥控（Phone Harness）。本仓库与用量中心插件解耦。
- [`design-implications.md`](research/design-implications.md)：候选路线 A（Web 透传）、B（语义窄 RPC）、C（原生 App + E2EE）；v0 非目标包括跨用户凭据共享、未授权监测、暗示官方背书、把用量中心扩成远程壳。

DSH Web 的安全模型以回环绑定、Host 校验与浏览器上下文为前提。任何「手机远程」若直接把完整 `/api` 面透传到 LAN / 公网，权限面会放大到接近桌面 Web。

## 决策

采用**路线 B：语义窄 RPC + 双平面**：

1. **管理面**：挂在宿主 `webServer` 上，DSH 本身仍只绑定回环。负责配对码/二维码展示、设备列表、吊销、审计查看。本机/SSH 受 loopback peer + Host/Origin 约束；远程只接受满足完整 `OwnerRequestPolicy` 的 HTTPS 反代请求，否则 403。
2. **移动数据面**：独立端口（默认 `6879`）上的自建服务，只暴露白名单 RPC（会话观察、审批/提问应答、短回复）。配对后走 E2EE；未认证连接只处理握手。
3. **手机端 v0**：浏览器页（不是原生 App）。桌面生成 pairing offer，手机扫码后在数据面完成握手。

本 ADR 冻结 M1 只交付可构建、可 `dsh plugin add` 的 Cordis 骨架与两份设计文档；不监听端口、不注册路由。

## 已评估替代

| 路线 | 结论 |
| --- | --- |
| **A. Web 透传** | 最快，可参考 pocket / web-remote。拒绝作为 MVP：权限面 ≈ 完整 `dsh web`，难以做 RPC 白名单与写操作审计，且会压迫宿主 `/api` 围栏。 |
| **B. 语义窄 RPC + 双平面** | **采纳**。控制面与数据面分离，默认拒绝未知方法，写操作可归因到 `deviceId`。代价是自建鉴权与 E2EE。 |
| **C. 原生 App + E2EE** | 安全与体验上限最高（可签名投递层，避免 LAN HTTP 页面被注入）。工程量与发布运维超出 v0。列为未来选项：M4 之后若浏览器投递层边界不可接受，再评估 RN / 原生客户端。 |

## 后果

- 必须自建鉴权（`deviceToken` 只存 SHA-256）与会话 E2EE（服务端 X25519 私钥 0600）。细节见 [`04-threat-model.md`](04-threat-model.md)。
- 手机端为浏览器页，存在 **LAN MITM 投递层边界**：E2EE 管不到页面首次 HTTP 下发。这是相对签名原生 App 的固有差距，不是实现疏漏。缓解见威胁模型（推荐 Tailscale / WireGuard；M4 可选自签 HTTPS + QR 钉死证书哈希）。
- 不得修改、不得削弱 `dsh web` `/api` 围栏与绑定；不得抢 `api-proxy` 的审批/提问 provider。
- 宿主版本钉死 **0.1.1-rc.2**。Cordis 插件契约（`name` / `inject` / `Config` / `apply`、`dsh.bundle.patch`、classic-script 客户端）以该版本的类型与加载器为准。`status.get` 上报的 `dshVersion` 必须与 `compatibility/dsh-bom.json` 的 `verified.dshVersion` 一致。

## 里程碑对齐

| 里程碑 | 范围 |
| --- | --- |
| M1（本 ADR 落地） | 可构建骨架 + 本 ADR + 威胁模型 |
| M2 | 配对 offer、LAN 数据面、手机浏览器页 |
| M3 | 窄 RPC 白名单、审批/提问、管理面路由 |
| M4（可选） | overlay 文档、自签 HTTPS + TOFU、原生 App 评估 |
| M5（可选） | 自建会合中继（桌面/手机出站连 Worker，业务仍 E2EE）；见 [`05-cloud-relay.md`](05-cloud-relay.md) |
