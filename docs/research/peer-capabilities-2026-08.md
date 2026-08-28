# 同类远程插件能力对照与可借鉴清单

> 调研日期：2026-08-28  
> 范围：与 `dsh-coding-remote-kit` 定位相近的「手机 / 远程访问 DSH」社区方案  
> 目的：回答「同类插件有什么值得借鉴」，并标出与本仓库已有能力的差距。  
> 更早的基线见 [`dsh-ecosystem-comparison.md`](dsh-ecosystem-comparison.md)（2026-08-18）。

## 1. 本仓库现状（对照锚点）

`dsh-coding-remote-kit@0.5.1`（≥`0.5.0`）已走 **路线 B**：窄 RPC + 双平面 + E2EE pairing。

| 已有 | 说明 |
| --- | --- |
| 配对 | QR + 8 位 PIN；桌面公钥钉死；`deviceToken` 只存 SHA-256 |
| 数据面 | 独立端口 `6879`；allowlist RPC |
| RPC | `status.get` / `session.{list,history,subscribe,unsubscribe,prompt,cancel,create}` / `host.subscribe` / `respond` / `device.name` |
| 网络 | LAN / Tailscale；可选 Cloudflare Quick Tunnel（只暴露数据面）；自建会合中继 |
| 客户端 | 手机浏览器 + 轻量 PWA 壳；非原生 App |
| 管理面 | Settings 设置页；设备列表 / 吊销；loopback 围栏 |
| 明确不做 | 完整 Web 透传；微信/飞书通道；改 `webserver` 绑 `0.0.0.0` |

产品差异化仍然成立：**语义窄控制面 + 业务 E2EE**，不是「再做一个 pocket」。

## 2. 生态分层（2026-08 快照）

| 路线 | 代表项目 | 星标量级 | 核心卖点 |
| --- | --- | --- | --- |
| **A. Web 透传** | [dsh-pocket](https://github.com/shaobeichen/dsh-pocket) (~766) | 高 | 扫码同屏完整 DSH；CF tunnel；8 位密码；移动布局 |
| | [dsh-remote-web-gateway](https://github.com/summer1238/dsh-remote-web-gateway) (~155) | 中 | 一次性配对 + 设备会话 + 可撤销；可选 GitHub 身份 |
| | [dsh-remote-mobile](https://github.com/IceApriler/dsh-remote-mobile) | 低 | Tailscale/LAN 门禁 + RSA；移动样式；插件共存检测 |
| | [dsh-web-remote](https://github.com/godchen520/dsh-web-remote) | 低 | CF tunnel + 自签 HTTPS；微信/飞书机器人 |
| | [dsh-mobile](https://github.com/saya-ch/dsh-mobile) (~171) | 中 | HTTPS + 证书固定；LAN/远程分通道；Android 壳；`/mobile` 定制 |
| **B. 语义窄遥控** | **本仓库** | — | E2EE RPC allowlist |
| | [201222-L/dsh-mobile-remote](https://github.com/201222-L/dsh-mobile-remote) (~35) | 低 | Flutter App；审批/推送/会话/模型配置；过程可见性 |
| | [zzj8442-blip/dsh-mobile-remote](https://github.com/zzj8442-blip/dsh-mobile-remote) | 低 | PWA + PIN；白名单桥接 `apiProxy`；gzip |
| | [DeepSeek-phone-harness](https://github.com/2903077918-lgtm/DeepSeek-phone-harness) | 低 | 旁路 agent；工具卡/终端/文件/OCR；SSE |
| **C. 通知/遥控通道** | [dsh-notifier](https://github.com/THEWOLFWALKER/dsh-notifier) (~80) | 中 | 27 通道推送；手机内审批/提问/停任务；身份配对 |
| **D. 远程认证层** | [xgone/dsh-remote](https://github.com/xgone/dsh-remote) (~51) | 低 | 账号 + MFA(TOTP)；远程 browse 工作区 |

> 星标会变；上表只作相对热度参考。`dsh-mobile-remote` npm 名被多仓占用，安装时必须钉死 owner。

## 3. 值得借鉴的能力（按优先级）

### P0 — 用户体感差距最大，且不破坏路线 B

| 能力 | 谁做得好 | 对本仓库的含义 |
| --- | --- | --- |
| **推送 / 离线提醒** | `dsh-notifier`（27 通道）、`201222-L`（Server酱/ntfy/Bark） | 手机锁屏时仍能收到「待审批 / 任务完成 / 卡住」。本仓只有连着 WS 才能看见卡片。可：**对接 `notifier` 服务**或自带 1–2 个推送适配器，载荷默认脱敏（仅事件类型 + 会话短码）。 |
| **过程可见性** | Phone Harness / `201222-L` | 活动条（思考中 / 正在调工具）、可折叠思考面板、工具卡状态。本仓 transcript 偏「消息气泡」。可：**订阅并渲染 turn / tool 状态推送**，仍禁止暴露完整危险 payload。 |
| **Steer / 插队语义** | zzj PWA（`mode: steer`）、Phone Harness | 本仓 `session.prompt` 已有 `queue`/`steer`，但 UI 未必突出「打断当前任务」。可：输入区明确双模式。 |
| **慢链路优化** | pocket（gzip/brotli）、zzj（gzip + 历史截断）、dsh-mobile（分页/压缩） | Tailscale 中继 / 4G 下大会话卡顿。可：history 分页默认、推送帧合并、静态壳缓存策略再压一档。 |
| **连接诊断一键报告** | `saya-ch/dsh-mobile` | 防火墙 / IP 选错 / 版本不匹配是第一大支持成本。**已落地**（Settings `connectionDiagnostics`：脱敏候选、cloudflared 钉死校验、隧道 `urlHost`、免责版本）。手机页诊断仍可加深。 |

### P1 — 安全与信任运营（路线 B 的护城河）

| 能力 | 谁做得好 | 对本仓库的含义 |
| --- | --- | --- |
| **链接 ≠ 权限** | `dsh-remote-web-gateway` | 我们已做到「配对后才进业务」。可再强化文案与设置页：**公网 URL / Tunnel 地址单独声明「不是凭证」**；配对码 TTL + 一次认领的 UX 对齐他们的威胁模型表述。 |
| **逐台撤销 + 会话 TTL** | gateway、IceApriler、本仓部分已有 | 补齐：设备会话默认 TTL、最后活跃时间、丢失手机一键清全。 |
| **登录限速 / 熔断** | pocket、IceApriler、xgone | PIN/握手失败按 IP + 全局阈值锁定；已有雏形则补齐文档与设置可见性。 |
| **公网开启强制免责勾选** | pocket | **已落地**：Quick Tunnel 开启前 checkbox；服务端要求 `disclaimerAccepted: true`。 |
| **cloudflared 供应链校验** | gateway（固定版本 + SHA-256 + Authenticode） | **已落地**：固定版本 + sha256 复验；拒绝裸 PATH / 非绝对路径；`0.5.1` 起 Settings 安装后无需重载即可 Start。 |
| **插件共存冲突检测** | IceApriler、`201222-L`（`/m` 冲突） | 设置页检测其他 remote/pocket 插件或 path 冲突，给一键诊断文案（我们已有 BOM 诊断，可扩到「远程类插件」）。 |

### P2 — 体验加深（仍保持窄 RPC，按需加方法）

| 能力 | 谁做得好 | 对本仓库的含义 |
| --- | --- | --- |
| **模型 / 权限预设只读或受限写** | `201222-L` | 外出改模型很刚需。可先 **只读展示当前模型**；写操作进独立 allowlist 项 + 审计，勿放开 `settings.*` / `credentials.*`。 |
| **新建会话：Agent 模式 + cwd 浏览** | `201222-L`、xgone（browse 对话框） | 本仓 `session.create` 已有可选 `cwd`。可加：工作区列表 RPC + 手机内目录浏览（只读 list，有界）。 |
| **后台任务 / 子代理 / goal** | `201222-L` v2.7 | 与 PC 同源卡片。工程量大；等上游 API 稳定后再评估。 |
| **会话 fork / rename / 搜索** | zzj 白名单较宽 | 按使用频率逐步加入 allowlist，而不是一次抄全。 |
| **图片附件** | Phone Harness（本地 OCR） | 手机拍照派活刚需；可走「上传 → 宿主 OCR/附件」窄方法，注意体积与隐私。 |

### P3 — 形态升级（M4+，非立刻抄）

| 能力 | 谁做得好 | 对本仓库的含义 |
| --- | --- | --- |
| **原生 App** | `201222-L` Flutter、`saya-ch` Android WebView 壳 | 解决 LAN MITM 投递层；系统通知更可靠。与 ADR 的 M4/C 路线一致。 |
| **IM 双向遥控** | `dsh-notifier`、`dsh-web-remote` 微信/飞书 | 不建议并进本包（产品面不同）。可文档推荐「本 kit + notifier」组合，或后续可选 outbound-only 桥。 |
| **`/mobile` 对话定制 UI** | `saya-ch/dsh-mobile` | 趣味强、攻击面大（`host.mjs` 等同本机权限）。与本仓「克制 companion」品牌冲突，**不建议学**。 |
| **账号 + TOTP 门禁** | `xgone/dsh-remote` | 面向「把整站挂公网」；与我们「设备配对」模型不同。若做多用户共享桌面再评估。 |
| **微信式无限上翻 + 草稿保留** | `201222-L` | 草稿本仓 0.4.0 已做；无限上翻/回到底部浮钮可直接搬交互。 |

## 4. 明确不要抄的

1. **把完整 `dsh web` 透传到公网**（pocket / 多数 remote）——与 ADR 0001 冲突，权限面不可审计。  
2. **改 `webserver` 为 `0.0.0.0:3080`**（IceApriler 等要求）——破坏宿主回环围栏。  
3. **长期万能 token 挂在 URL query**（早期 web-remote 风格）——gateway 已证明更好的模型。  
4. **把用量中心 / OAuth / 通知中枢塞进本包**——保持单产品面。  
5. **Agent 可任意改手机宿主扩展**（`/mobile`）——威胁模型不可接受。

## 5. 建议落地顺序（技术切片，非日历）

1. **诊断页 + 公网免责勾选 + tunnel 二进制校验** — **已落地**（`connectionDiagnostics`、启动前 `disclaimerAccepted`、cloudflared pin+re-verify）。  
2. **推送桥（notifier 或 ntfy/Bark）+ 审批深链回手机页** — 补齐「人不在线」场景。  
3. **UI：活动条 / 工具状态 / steer 开关 / 历史分页** — 仍用现有订阅，主要是渲染与 RPC 参数。  
4. **只读模型信息 + 受限 cwd 浏览** — 扩展 allowlist，逐方法加审计。  
5. **M4：签名 HTTPS 或 Android 壳** — 关闭投递层缺口后再谈原生通知。

## 6. 参考链接

- https://github.com/shaobeichen/dsh-pocket  
- https://github.com/summer1238/dsh-remote-web-gateway  
- https://github.com/201222-L/dsh-mobile-remote  
- https://github.com/IceApriler/dsh-remote-mobile  
- https://github.com/saya-ch/dsh-mobile  
- https://github.com/THEWOLFWALKER/dsh-notifier  
- https://github.com/2903077918-lgtm/DeepSeek-phone-harness  
- https://github.com/zzj8442-blip/dsh-mobile-remote  
- https://github.com/xgone/dsh-remote  
- https://github.com/godchen520/dsh-web-remote  
- https://github.com/AdamPlatin123/awesome-dsh-plugins  

## 7. 声明

公开信息整理，不构成对各项目安全性的背书。安装任何远程访问组件前应自行审阅源码、权限与网络暴露面。
