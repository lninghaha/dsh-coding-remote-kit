# 设计启示与非目标（调研史）

> **历史文档。** 路线 A/B/C 的取舍已由 [`../01-mvp-scope.md`](../01-mvp-scope.md) 冻结为路线 B；威胁模型见 [`../04-threat-model.md`](../04-threat-model.md)。下文保留调研当时的表述，不再当作现行规格。
>
> 基于 `orca-mobile-connection.md` 与 `dsh-ecosystem-comparison.md`。

## 1. 建议产品意图

在操作者自有的 DSH Web 宿主上，提供：

1. **一次配对**：手机与本机 profile 绑定（令牌 + 可选公钥钉死）  
2. **私网优先路径**：LAN / Tailscale；公网隧道仅可选且需显式开启  
3. **窄控制面**：会话状态、流式输出观察、审批/提问应答、短回复；重编辑仍回桌面  
4. **标准插件形态**：一个 Cordis 服务端插件 + classic-script（或后续独立 App）客户端注册，不启动第二套无鉴权公网服务接管宿主

与 Orca 对齐的是「companion」意图；与 DSH 对齐的是「插件 + 回环安全模型」。

## 2. 候选实现路线

| 路线 | 描述 | 优点 | 风险 / 成本 |
| --- | --- | --- | --- |
| A. Web 透传增强 | 插件反向代理 `dsh web` + 移动布局 + token | 最快；可参考 pocket/remote | 权限面 ≈ 完整 Web；难做细粒度 allowlist |
| B. 语义遥控层 | 插件暴露窄 RPC / 事件订阅，手机专用轻 UI | 更接近 Orca；带宽与清晰度更好 | 需梳理 DSH 宿主 API 与审批模型 |
| C. 原生 App + E2EE | RN/原生客户端 + 配对公钥 + 加密 RPC | 安全与体验上限最高 | 工程量大；发布与协议版本运维重 |

**研究阶段倾向**：先写清威胁模型与 MVP（可能落在 A→B 渐进），不急于上 C。

## 3. 安全不变量（拟继承）

对齐用量中心等本地插件的习惯：

- 不得削弱回环 peer / Host / 同源与请求上下文约束  
- 不得在无认证情况下把插件 API 裸暴露公网  
- SQLite / 日志 / 导出默认不含凭据、prompt/response、cwd、credential 路径  
- 公网路径若存在：短时令牌、可轮换、可一键关闭；文档明确风险  

## 4. 明确非目标（v0）

- 不做跨用户凭据共享或批量账号运营工具  
- 不做未授权监测第三方账户  
- 不暗示 DeepSeek 官方背书  
- 不把 `dsh-hub-oauth-gateway` 扩成远程壳  
- 首版不承诺官方 Relay 对等物（可用 Tailscale / 用户自建隧道）

## 5. 建议里程碑（仅规划）

1. **M0**：本仓库调研文档（当前）  
2. **M1**：威胁模型 + MVP 范围 ADR + 空 Cordis 插件可 `dsh plugin add`  
3. **M2**：配对与局域网访问（扫码 + token）冒烟  
4. **M3**：窄权限语义面（审批/提问/状态）或确认坚持 Web 透传  
5. **M4**：可选隧道、文档、隔离 `DSH_HOME` 冒烟清单  

## 6. 命名与仓库

- 仓库：`lninghaha/dsh-mobile-remote`  
- 包名（未来）：待定，避免与 `dsh-web-remote` / `dsh-pocket` 撞名造成安装混淆；公开文档需写清差异表  

## 7. 后续调研待办

- [ ] 细读 DSH Web 的 session / approval / events 宿主 API（版本钉死某 `dsh` rc）  
- [ ] 实测 `dsh-pocket` 与 `dsh-web-remote` 安装与权限面（隔离 profile）  
- [x] 决定 MVP 走路线 B（见 [`../01-mvp-scope.md`](../01-mvp-scope.md)）
- [x] 写出威胁模型与「禁止事项」清单（[`../04-threat-model.md`](../04-threat-model.md)）
- [x] **方案 1：Cloudflare Quick Tunnel（只暴露数据面 6879）**。已实现于 `src/server/tunnel.ts` + 设置页「公网」入口。
- [ ] **方案 2：自建会合中继**（桌面/手机连 Worker，业务 E2EE）。见 [`../05-cloud-relay.md`](../05-cloud-relay.md)。非 Quick Tunnel 里程碑。  
