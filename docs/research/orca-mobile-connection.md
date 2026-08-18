# Orca 远程手机连接：实现调研

> 调研日期：2026-08-18  
> 对象：[StablyAI Orca](https://github.com/stablyai/orca) Mobile Companion  
> 文档：[Mobile companion — Orca Docs](https://www.onorca.dev/docs/mobile)  
> 目的：理解「手机遥控桌面 Agent runtime」的成熟做法，供 DSH 侧远程插件设计参考。

## 1. 结论摘要

Orca 的手机连接**不是**在手机上跑 Agent，而是：

- **Desktop / Electron（或 `orca serve`）**：权威 runtime（Agent、PTY、worktree、浏览器）
- **Mobile（React Native / Expo）**：companion——观察状态、终端回放、短回复、审批类轻操作
- **可选 Orca Relay**：跨网 WSS 中继；业务载荷走 **E2EE**，中继原则上不可读明文

信任锚：**配对时交换的桌面公钥钉死 + deviceToken**，不是「连上 WebSocket 就能控」。

## 2. 角色与端口

| 组件 | 职责 | 备注 |
| --- | --- | --- |
| Desktop mobile WS | JSON-RPC / 流服务 | 默认监听 `6768`（开发态可能避开冲突端口） |
| Mobile App | Expo Router UI + `mobile/src/transport/*` | 非完整 IDE |
| Relay cell | `wss://{cell}/v1/connect/{relayHostId}` | 需账号；外层 `relay-auth` |

官方定位：*“remote control for the desktop you already have running.”*

## 3. 配对（Pairing）

桌面生成 `PairingOffer`（schema 版本 `v: 2`），编码为 deep link：

```text
orca://pair?code=<base64url(JSON)>
```

载荷核心字段（见上游 `src/shared/mobile-relay-pairing-offer.ts`）：

| 字段 | 含义 |
| --- | --- |
| `endpoint` | 直连地址，例如 `ws://192.168.0.10:6768` |
| `deviceToken` | 该手机的设备凭证 |
| `publicKeyB64` | 桌面 Curve25519 公钥（手机钉死） |
| `relay?` | 可选：`directorUrl` / `cellUrl` / `relayHostId` / 短时 `inviteToken` 等 |

手机扫码或粘贴后持久化 host；`deviceToken` 进入安全存储（如 Keychain / `expo-secure-store`），不与明文 host 元数据混放。

## 4. 建链路径

### 4.1 直连（LAN / Tailscale 等）

1. 手机连接 `ws://<host>:6768`（或用户编辑后的地址）  
2. 关闭桌面则会话断开；重开后手机可自动重连  

### 4.2 Relay

1. 手机连接 `wss://{cellUrl}/v1/connect/{relayHostId}`  
2. 先发 `relay-auth`（invite / resume credential）  
3. 再进入与直连相同的 E2EE 业务通道  
4. 另有 relay→直连升级、lease 轮换、断线恢复等状态机（见 `mobile-relay-*`、`mobile-endpoint-supervisor.ts`）

区域选择由**桌面**探针完成；手机使用配对载荷中的 cell URL，不独立选区。

## 5. E2EE v2 握手

密码学栈（`mobile/src/transport/e2ee.ts`）：

- Curve25519 ECDH（tweetnacl `box`）
- XSalsa20-Poly1305 认证加密
- RN/Hermes 侧用 `expo-crypto` 提供安全随机数

物理通道状态机（`MobileE2EEV2PhysicalChannel`）：

```text
awaiting-ready → awaiting-authenticated → ready
```

步骤概要：

1. 手机发送 `e2ee_hello`（client 公钥 + nonce + capabilities）  
2. 桌面返回 `e2ee_ready`；手机校验公钥 **必须等于配对钉死公钥**  
3. 由 shared secret + handshake transcript 派生密钥日程  
4. 手机发送 `e2ee_auth`（`transcriptHash` + `deviceToken`）  
5. 桌面确认 `e2ee_authenticated` 后进入业务帧  

加密后：

- JSON-RPC：文本帧（密封）  
- 终端 / 浏览器 screencast：二进制帧  
- 出站带 backpressure 队列，避免撑爆 WebSocket buffer  

## 6. 业务面（受限 RPC）

认证后手机是 **allowlist 约束** 的 RPC 客户端，例如：

- `status.get`（交换协议版本，做兼容硬阻断）
- worktree / terminal subscribe & send
- 设置、账号切换、简易 source control、browser screencast 等

桌面侧测试明确：诸如 `files.delete` 等危险方法对 mobile-scoped token **拒绝**。

协议版本：`MOBILE_PROTOCOL_VERSION` / `DESKTOP_PROTOCOL_VERSION` 与最小兼容版本；不兼容时 UI 硬拦截并引导更新（应对 App Store 滞后）。

## 7. 关键设计约束（可借鉴）

1. 手机不是第二套 runtime  
2. 信任锚 = 配对公钥 + deviceToken  
3. Relay 不解密业务内容  
4. 协议分版本，避免静默坏行为  
5. 移动端能力故意收窄（遥控 + 观察）  

## 8. 上游源码地图（便于复查）

| 区域 | 路径 |
| --- | --- |
| 配对编解码 | `src/shared/pairing.ts`、`mobile/src/transport/pairing.ts` |
| Offer schema | `src/shared/mobile-relay-pairing-offer.ts` |
| E2EE | `mobile/src/transport/e2ee.ts`、`mobile-e2ee-v2-*.ts` |
| 直连 RPC | `mobile/src/transport/rpc-client.ts` |
| Relay | `mobile-relay-e2ee-link.ts`、`mobile-relay-physical-client.ts` 等 |
| 桌面入口 | `src/main/runtime/runtime-rpc.ts`、`src/main/ipc/mobile.ts`、`device-registry.ts` |

## 9. 参考链接

- https://www.onorca.dev/docs/mobile  
- https://github.com/stablyai/orca/blob/main/mobile/README.md  
- https://github.com/stablyai/orca（上游；实现细节以当时 `main` 为准）  

## 10. 声明

本笔记为社区独立调研，**不代表** Orca / StablyAI 背书；描述基于公开文档与公开源码阅读，可能随上游演进而过时。
