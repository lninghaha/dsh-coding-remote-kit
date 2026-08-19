# TODO：方案 2 自建会合中继

状态：**待办（未实现）**。方案 1（Cloudflare Quick Tunnel，只暴露数据面 6879）已落地；本方案 2 是明确**非本里程碑**，仅在需要“不想把本机端口打到公网”时评估。

## 动机

- 手机在 4G、未装 Tailscale，又**不想**把本机端口 Funnel / Quick Tunnel 打到公网。
- 中继只做桌面与手机的会合；业务帧仍走现有 X25519 + secretbox，中继不可读会话。

## 方向（Orca / ZCode 骨架）

- [ ] Cloudflare Worker（或等价）作为会合点：桌面与手机各自出站连接
- [ ] 配对链接指向 Worker 上的 HTTPS 页 + fragment 令牌，不包含内网 IP
- [ ] 不透传 `dsh web` / 3080
- [ ] 威胁模型补充：中继可见元数据（谁在连），不可见 RPC 明文
- [ ] 非本里程碑；不要在方案 1 的 `cloudflared` 子进程里夹带 Worker 逻辑

## 非目标

- 微信 / 飞书 Bot Channel
- 用反向代理把 GUI 同源路径挂成 `/m`（与 `dsh web` 混权；示例：`https://example.com/m`）
