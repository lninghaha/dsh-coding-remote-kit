# dsh-mobile-remote

DeepSeek Harness（DSH）**远程手机访问**插件。

目标：在电脑上跑 `dsh web`，用手机安全地观察与轻量操控 Agent——对标 [Orca Mobile Companion](https://www.onorca.dev/docs/mobile) 的产品意图，并兼容 DSH「Everything is a Plugin」形态。

> 宿主版本钉死 `@deepseek-ai/dsh@0.1.0-rc.7`。本仓库是社区插件，**不暗示 DeepSeek 官方背书**。

## 状态

| 阶段 | 状态 |
| --- | --- |
| 调研（Orca / DSH 生态） | ✅ 见下方调研文档 |
| M1 插件骨架 + ADR / 威胁模型 | ✅ |
| M2 配对 / 局域网数据面 | ✅ |
| M3 窄 RPC / 审批面 | ✅ 本里程碑 |

## 调研文档

- [`docs/research/orca-mobile-connection.md`](docs/research/orca-mobile-connection.md) — Orca 远程手机连接实现拆解
- [`docs/research/dsh-ecosystem-comparison.md`](docs/research/dsh-ecosystem-comparison.md) — DSH 生态现有远程/手机方案对比
- [`docs/research/design-implications.md`](docs/research/design-implications.md) — 对本项目的设计启示与非目标

设计冻结：

- [`docs/adr/0001-mvp-scope.md`](docs/adr/0001-mvp-scope.md) — MVP 范围（路线 B：语义窄 RPC + 双平面）
- [`docs/threat-model.md`](docs/threat-model.md) — 资产、攻击者、不变量与诚实边界

## 开发

```bash
pnpm install && pnpm build
```

构建产物：

- `lib/server/index.js` — Cordis 服务端入口（ESM：`name` / `inject` / `Config` / `apply`）
- `lib/client.js` — DSH Web 设置页 classic-script（`window.__ModuleLoader__.load`）
- `lib/mobile/` — 手机页（`/m` + E2EE 握手 + 会话列表 / 审批 / 短回复）
- [`docs/protocol.md`](docs/protocol.md) — 白名单、推送信封、`respond` 两种 payload

安装到本机 DSH profile（数据面默认 `127.0.0.1:6879`；配对时 widen 到 `0.0.0.0`）。手机页可列会话、处理审批/提问并发送短回复：

```bash
dsh plugin add /absolute/path/to/dsh-mobile-remote
```

## 与现有项目的关系

- 本项目独立于 [`dsh-hub-oauth-gateway`](https://github.com/lninghaha/dsh-hub-oauth-gateway)（用量中心）。
- 不替代官方 `@deepseek-ai/dsh`；仅为社区插件方向的预研与实现载体。

## 安全原则（草案）

- 默认本地优先：优先 LAN / Tailscale 等私网路径，不鼓励裸暴露公网端口。
- 凭据与会话不得写入公开日志、截图或仓库。
- 手机端能力应受 allowlist 约束（只读为主 + 显式审批类写操作）。
- 示例统一使用 `example.com`、`127.0.0.1`、`YOUR_TOKEN` 等占位符。

完整不变量与禁止事项见 [`docs/threat-model.md`](docs/threat-model.md)。

## 许可

MIT（见 [`LICENSE`](LICENSE)）。
