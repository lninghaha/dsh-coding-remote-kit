# DSH 生态：远程 / 手机访问方案对比

> 调研日期：2026-08-18（初版）· **2026-08-28 增补见 [`peer-capabilities-2026-08.md`](peer-capabilities-2026-08.md)**  
> 范围：DeepSeek Harness（`@deepseek-ai/dsh`）官方能力与社区「手机远程」相关项目  
> 目的：回答「DSH 有没有类似 Orca companion 的东西？」并给出选型对照。

## 1. 结论

| 问题 | 答案 |
| --- | --- |
| 官方是否内置 Orca 级 Mobile Companion？ | **否** |
| 是否存在社区远程/手机方案？ | **是**，多为插件或独立 relay |
| 与 Orca 最像的点 | 「桌面跑 Agent，手机观察/轻操控」 |
| 与 Orca 最大差异 | 多数是 **透传 `dsh web`** 或薄 API 壳，而非原生 App + E2EE pairing |

本仓库（`dsh-coding-remote-kit`，Cordis id `mobile-remote`）定位为：**独立预研与后续实现载体**，与用量中心插件 `dsh-hub-oauth-gateway` 解耦。npm 名 `dsh-mobile-remote` 属于其他项目，勿混用。

## 2. 官方基线

- 宿主：`dsh web`（常见回环 `127.0.0.1:3080`）  
- 扩展模型：Cordis 服务端插件 + classic-script 客户端  
- npm 可见核心包示例：`@deepseek-ai/dsh`、`@deepseek-ai/dsh-web-app` 等  
- **未发现**官方一等公民的「配对手机 App + E2EE RPC」产品线  

官方讨论中有社区关于「手机远程控 Agent」的问答，例如：

- [deepseek-harness Discussion #2250](https://github.com/deepseek-ai/deepseek-harness/discussions/2250)

## 3. 社区方案对照表

| 项目 | 形态 | 网络路径 | 体验模型 | 安全要点（公开描述） |
| --- | --- | --- | --- | --- |
| [dsh-pocket](https://github.com/shaobeichen/dsh-pocket) | DSH 插件 | LAN 扫码；可选 cloudflared 公网 | 透传 Web + 移动布局 | 8 位密码；公网免责勾选；限速 |
| [dsh-remote-web-gateway](https://github.com/summer1238/dsh-remote-web-gateway) | DSH 插件 | CF Quick Tunnel | 透传 Web；手机适配 | **链接≠权限**；一次性配对；设备可撤销；可选 GitHub 身份 |
| [dsh-mobile](https://github.com/saya-ch/dsh-mobile) | 插件 + Android 壳 | LAN HTTPS + Funnel/cpolar | 透传 + 触屏布局 | 证书固定；LAN/远程分通道 |
| [201222-L/dsh-mobile-remote](https://github.com/201222-L/dsh-mobile-remote) | 插件 + Flutter | LAN / 蒲公英等 | **语义遥控**（审批/推送/会话/模型） | authToken；禁公网映射 3080 |
| [dsh-notifier](https://github.com/THEWOLFWALKER/dsh-notifier) | 通知插件 | 既有 IM/推送通道 | 审批/提问/停任务走消息 | 身份配对；HMAC 一次性动作 |
| [dsh-web-remote](https://github.com/godchen520/dsh-web-remote) | DSH 插件 | CF Quick Tunnel + LAN HTTP/HTTPS | 透传 Web；侧栏手机面板 | 随机 token / Cookie；局域网可配置免 token |
| [DeepSeek Phone Harness](https://github.com/2903077918-lgtm/DeepSeek-phone-harness) | 独立 agent/relay | LAN / Tailscale；可选 Cloudflare Worker | **语义遥控**（聊天、审批卡、提问卡、终端、文件） | Bearer token；强调勿裸暴露端口 |
| 其他 UI 合集（如含 remote mobile 条目的社区 UI 仓） | 插件/皮肤 | 视项目而定 | 多为 Web 侧适配 | 需个案审阅 |

可借鉴能力的优先级与落地切片见 [`peer-capabilities-2026-08.md`](peer-capabilities-2026-08.md)。

### 3.1 dsh-pocket（最像「装插件就能用」）

- 设置页「手机访问」：局域网二维码 / 开启公网隧道后再扫码  
- 实现倾向：改头反向代理 loopback 上的 DSH，HTTP + WebSocket 透传，注入移动端布局  
- 优点：安装路径短、与 DSH 插件模型一致  
- 局限：权限面接近完整 Web；不是 Orca 式窄 RPC allowlist  

### 3.2 dsh-web-remote

- 公网：cloudflared；局域网：HTTP + 自签名 HTTPS  
- 侧栏常驻手机图标面板：复制链接、扫码、启停隧道  
- 注意：公网链接含令牌，泄露即等同授权；重启可能换链  

### 3.3 DeepSeek Phone Harness（意图更接近 Orca companion）

- 手机浏览器打开 console（示例端口 `8788`）  
- 强调**语义通道**而非投屏：工具调用时间线、审批/提问卡片、流式输出  
- 4G/5G：推荐 Tailscale，而非裸公网  
- 形态上常是**旁路 agent**，不一定是 in-host Cordis 插件  

## 4. 与 Orca 的架构对比

| 维度 | Orca | DSH 社区常见做法 |
| --- | --- | --- |
| 客户端 | 独立 iOS/Android App | 手机浏览器为主 |
| 传输 | E2EE WebSocket RPC + deviceToken | 反向代理 / HTTP(S) + token；少数自建 WS |
| UI | 为手机裁剪的 companion | 透传 Web 或轻量移动页 |
| 权限 | mobile method allowlist | 往往接近完整 Web 能力 |
| 跨网 | 官方 Relay（密文转发） | Tailscale / cloudflared / 自建 |

## 5. 对本仓库的含义

1. **有市场空位**：官方无对等物；社区以「透传」为主，「语义窄控制面 + 强配对」仍可差异化。  
2. **勿重复造弱隧道**：若只做 cloudflared + 扫码，价值易与 pocket/remote 重叠。  
3. **可借鉴 Orca 的不变量**：桌面权威、配对钉死身份、能力 allowlist、协议版本、私网优先。  
4. **可借鉴 DSH 插件契约**：单 Cordis 插件 + classic-script；保持回环与本地 API 防护习惯（参见用量中心等项目的安全边界）。  
5. **与 `dsh-hub-oauth-gateway` 解耦**：远程访问是另一产品面，不应塞进用量中心。  

## 6. 参考链接

- https://github.com/deepseek-ai/deepseek-harness  
- https://github.com/shaobeichen/dsh-pocket  
- https://github.com/godchen520/dsh-web-remote  
- https://github.com/2903077918-lgtm/DeepSeek-phone-harness  
- https://github.com/deepseek-ai/deepseek-harness/discussions/2250  

## 7. 声明

以上为公开信息整理，不构成对各项目安全性的背书；安装任何远程访问组件前应自行审阅源码、权限与网络暴露面，并仅用于操作者拥有或获授权的账户与 endpoint。
