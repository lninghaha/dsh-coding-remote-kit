# 威胁模型（v0）

> 与 [`adr/0001-mvp-scope.md`](adr/0001-mvp-scope.md) 配套。技术名词保留英文。  
> 文档示例一律使用 `example.com` / `127.0.0.1` / `YOUR_TOKEN` 占位，不得写入真实 token、私钥或内网主机名。

## 资产

| 资产 | 说明 |
| --- | --- |
| `deviceToken` | 配对后手机持有的长期秘密。服务端只存 SHA-256 哈希。 |
| 服务端 X25519 私钥 | 数据面 E2EE 的身份锚。文件 0600，目录 0700。 |
| 会话内容 | Agent 输出、用户短回复、当前会话元数据。经 E2EE 后对中继/旁路不可读。 |
| 审批决策 | 批准 / 拒绝 / 提问应答。写操作必须可归因到 `deviceId`。 |

## 攻击者

| 攻击者 | 能力假设 |
| --- | --- |
| LAN 被动嗅探 | 可读同网段明文 HTTP / WS。 |
| LAN 主动 MITM | 可 ARP/DNS 欺骗，在页面加载时注入或替换 JS。 |
| QR 泄露 | 拍照、截图、投屏使 pairing offer 离开操作者控制。 |
| 手机丢失 | 已配对设备落入他人之手，直到吊销。 |
| 恶意插件 | 与本插件同住一个 DSH profile，可读部分宿主服务。 |

## 安全不变量

1. **未认证连接只处理握手。** 数据面在完成配对握手之前，不接受任何业务 RPC、不返回会话内容。
2. **秘密落地约束。** `deviceToken` 只存 SHA-256 哈希；私钥、注册表、审计文件权限 0600（所在目录 0700）；密钥永不进入日志、截图或仓库。
3. **RPC 白名单默认拒绝。** 未知方法一律拒绝。写操作（审批、提问应答、短回复）写入审计记录，可归因到 `deviceId`。
4. **管理面回环围栏。** 管理面只绑回环，校验 `Host`、浏览器上下文与 CSRF 守卫；来自非回环的请求一律 403。
5. **不触碰宿主围栏。** 不修改、不削弱 `dsh web` `/api` 的绑定与鉴权；不抢 `api-proxy` 的审批 / 提问 provider。
6. **文档占位。** 一切公开示例使用 `example.com` / `127.0.0.1` / `YOUR_TOKEN`，不出现真实地址或凭据。

## 诚实边界（v0）

手机页经 **LAN HTTP 明文下发**。主动 LAN MITM 可在页面加载时注入恶意 JS；页面一旦被替换，后续 E2EE 只保护「恶意脚本与服务器之间」的信道，管不到投递层。

这是**浏览器客户端相对签名原生 App 的固有差距**，不是本里程碑的实现疏漏。

缓解（按优先级）：

- 推荐把数据面放在 Tailscale / WireGuard 等加密 overlay 内，而不是裸 LAN。
- M4 可选：自签 HTTPS + 二维码钉死证书哈希（TOFU）。
- 未来选项：路线 C 原生 App，用签名包投递客户端，彻底离开「首次 HTTP 下发」模型。

**明确出界（v0 不防、不声称防）：**

- 桌面被控（攻击者已在跑 `dsh web` 的机器上）
- 浏览器扩展窃取设置页 / 配对码
- 通用 XSS（宿主或其它插件的 DOM 注入）

## 禁止事项 / Prohibitions

以下文案可直接展示给用户（中英对照）。

- **不共享他人凭据。** Do not share another person's credentials.
- **不监测未授权账户。** Do not monitor accounts you are not authorized to access.
- **不裸暴露公网端口。** Do not expose the data-plane port on the public Internet without an overlay or equivalent control.
- **不暗示 DeepSeek 官方背书。** This plugin is not affiliated with, and is not endorsed by, DeepSeek.

错误示例（禁止照抄到生产）：`ws://203.0.113.10:6879?token=s3cret`  
正确示例：`ws://127.0.0.1:6879` 或 `wss://example.com`，token 写作 `YOUR_TOKEN`。
