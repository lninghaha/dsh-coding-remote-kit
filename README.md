# dsh-mobile-remote

DeepSeek Harness（DSH）**远程手机访问**插件（研究阶段）。

目标：在电脑上跑 `dsh web`，用手机安全地观察与轻量操控 Agent——对标 [Orca Mobile Companion](https://www.onorca.dev/docs/mobile) 的产品意图，并兼容 DSH「Everything is a Plugin」形态。

> 当前仓库仅提交调研与设计笔记，**尚未实现可安装的 Cordis 插件运行时**。实现将在后续提交中按里程碑推进。

## 状态

| 阶段 | 状态 |
| --- | --- |
| 调研（Orca / DSH 生态） | 进行中（本仓库首批文档） |
| 方案选型与威胁模型 | 待写 |
| Cordis 插件脚手架 | 未开始 |
| 配对 / 传输 / 手机 UI | 未开始 |

## 调研文档

- [`docs/research/orca-mobile-connection.md`](docs/research/orca-mobile-connection.md) — Orca 远程手机连接实现拆解
- [`docs/research/dsh-ecosystem-comparison.md`](docs/research/dsh-ecosystem-comparison.md) — DSH 生态现有远程/手机方案对比
- [`docs/research/design-implications.md`](docs/research/design-implications.md) — 对本项目的设计启示与非目标

## 与现有项目的关系

- 本项目独立于 [`dsh-hub-oauth-gateway`](https://github.com/lninghaha/dsh-hub-oauth-gateway)（用量中心）。
- 不替代官方 `@deepseek-ai/dsh`；仅为社区插件方向的预研与后续实现载体。

## 安全原则（草案）

- 默认本地优先：优先 LAN / Tailscale 等私网路径，不鼓励裸暴露公网端口。
- 凭据与会话不得写入公开日志、截图或仓库。
- 手机端能力应受 allowlist 约束（只读为主 + 显式审批类写操作）。
- 示例统一使用 `example.com`、`127.0.0.1`、`YOUR_TOKEN` 等占位符。

## 许可

拟采用 MIT（见 [`LICENSE`](LICENSE)）。
