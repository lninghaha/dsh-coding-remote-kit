# 移动数据面协议（M3）

手机信封：`{ id, method, params? }` → `{ id, ok: true, result }` 或 `{ id, ok: false, error: { code, message } }`。
表外方法一律 `forbidden`。写操作失败（上游 `result.ok === false` 或抛错）折成 `upstream_error`，只回传上游 `error.code` / `error.message`，不回传 `details` 或 prompt。

## 白名单

| 方法 | params | result |
| --- | --- | --- |
| `status.get` | （可省略） | `{ protocolVersion, minCompatibleMobileVersion, pluginVersion, dshVersion, deviceScope }` |
| `session.list` | `{}` | `{ items: [{ sessionId, title?, running, blank, updatedAt, cwd? }] }` |
| `session.history` | `{ sessionId, beforeSeq?, maxMessages? }` | `{ events, hasMore }`（去掉巨大 attachment data） |
| `session.subscribe` | `{ sessionId }` | `{ accepted: true }`，开始接收该会话 mux 推送 |
| `session.unsubscribe` | `{ sessionId }` | `{ accepted: true }` |
| `host.subscribe` | `{}` | `{ accepted: true }`，开始接收 host 推送 |
| `session.prompt` | `{ sessionId, mode?: 'queue'\|'steer', text }` | 转 `content:[{ type:'text', text }]`，默认 `queue`；空 text → `invalid_params` |
| `session.cancel` | `{ sessionId }` | 上游 `accepted` |
| `session.create` | `{ cwd? }` | 上游 `sessions.create`；审计只记 method + cwd basename |
| `respond` | 见下 | `{ accepted: true }` |
| `device.name` | `{ name }` | `{ accepted: true }`；仅作为认证身份字段未被保存时的兼容回退 |

`session.prompt` / `session.cancel` / `respond` 记审计 `rpc_write`，`detail` 只有 `{ method, sessionId }`。

数据面 `POST /m/claim` `{ code }`（8 位配对 PIN）→ `{ offer }`，供手机手输；失败不计完整码。每 IP 每分钟最多 8 次失败。

## 推送信封

已认证连接上的服务端推送：

```
{ push, data, rpcId? }
```

`push`：`session.event` | `session.subscribed` | `approval.requested` | `approval.resolved` | `question.requested` | `question.resolved` | `session.queue` | `host.event` | `inbox.reset`。

仅 `approval.requested` / `question.requested` 必带 `rpcId`（mux 帧外层原样保留），供 `respond` 回显。

mux 重连后 host 会先发送 `inbox.reset`，再按原始稳定 `rpcId` 重放仍待处理的 approval/question；`host.subscribe` 可返回 `{ accepted: true, pending?: MobilePush[] }` 供新客户端恢复全局待办。正文事件仍只发送给 session 订阅者。`session.queue` 的 items 只含 `id` / `placement` / 文本摘要。

可选离线推送桥（管理面配置，默认关闭）：`approval.requested` 时可向 allowlist 内的 ntfy/Bark endpoint 发送脱敏提醒。ntfy 使用 JSON POST 到 endpoint 根路径，`topic` 位于请求体。深链格式：`/m/?focus=approval&sessionId=…&approvalId=…`（手机页打开后保留定位参数，直到待办恢复或明确不可恢复）。

## respond 两种 payload

审批：

```
{ rpcId, sessionId, approvalId, outcome: 'allowed-once' | 'rejected' }
```

提问：

```
{ rpcId, sessionId, answers: [{ id, selected, custom? }] }
```

缺 `rpcId` 或 `sessionId` → `invalid_params`。

## 认证身份扩展

`e2ee_auth` 保留原有四个必填字段，并允许两个可选字段：

```json
{
  "type": "e2ee_auth",
  "v": 1,
  "transcriptHashB64": "…",
  "deviceToken": "…",
  "deviceName": "Pocket DSH",
  "clientMetadata": {
    "mobileProtocolVersion": 1,
    "locale": "zh-CN",
    "platform": "Android"
  }
}
```

- 服务端接受可选 `deviceName` / `clientMetadata`，旧客户端完全不发送这些字段时仍按原四字段形状认证。
- 官方移动端默认继续发送冻结的四字段认证消息，认证成功后再通过可选 `device.name` RPC 设置名称，因此新移动端仍能连接严格校验旧形状的桌面端；握手扩展保留给显式协商后的客户端。
- `deviceName` 进行 Unicode NFC、首尾去空白和连续空白折叠；控制字符与格式控制字符会使认证失败。协议不自行声明无依据的长度上限。
- `clientMetadata.platform` 可省略；元数据只用于兼容诊断，不进入握手 transcript，也不作为授权依据。
- 新客户端在认证后仍可调用 `device.name`，用于对尚未消费身份扩展的兼容实现补写名称；它不是新协议的主命名路径。

## 会合中继外层（`dshmr-relay/v1`）

可选通道。Worker 只转发拼接后的字节；**不**改上面的 RPC 表，也**不**改 `dshmr-e2ee/v1`。`HANDSHAKE_CONTEXT.transport` 仍为 `direct`。Offer 仍是 v1 exact keys，中继只写进 `pageUrl` / `endpoint`。

控制面（桌面 ↔ Worker，JSON text）：

| 消息 | 方向 | 字段 |
| --- | --- | --- |
| `host_hello` | 桌面 → Worker | `v`, `hostId`, `hostToken` |
| `host_ok` / `host_error` | Worker → 桌面 | `hostId` / `error.code` |
| `invite_put` | 桌面 → Worker | `invite`, `expiresAt`, `offerId` |
| `invite_ack` | Worker → 桌面 | `offerId` |
| `claim` | Worker → 桌面 | `requestId`, `code`（8 位 PIN，不是完整码） |
| `claim_result` | 桌面 → Worker | `requestId`, `offer?`, `error?` |
| `phone_waiting` | Worker → 桌面 | `ticket`, `expiresAt` |
| `ping` / `pong` | 双向 | — |

手机：

- 配对 `wss://<origin>/v1/phone/<hostId>?invite=…`
- 重连 `wss://<origin>/v1/phone/<hostId>?resume=1`

桌面再出站 `wss://<origin>/v1/accept/<ticket>`，之后与 `/m/ws` 同一套 E2EE + RPC。规格见 [`05-cloud-relay.md`](05-cloud-relay.md)。

## 0.6.0 可选恢复能力

`host.subscribe` 成功结果为 `{ accepted: true, pending?: PushEnvelope[] }`。`pending` 仅含现有 `approval.requested` / `question.requested` 推送形状与原始 `rpcId`；旧服务端省略该字段仍可连接。主机订阅接收待办增量，普通 `session.event` 仍要求对应会话订阅。

`{ push: "inbox.reset", data: {} }` 表示共享 mux 正在重建，客户端清空旧待办。DSH `0.1.1-rc.2` 重开 mux 时先发 attached session 的 subscribed，再回放仍待处理的请求，沿用原 `rpcId`；`since` 在该版本不提供历史续传，正文通过 history 重新获取。该合同没有回放完成帧，不能把暂时空的 pending 当作已解决。

客户端按视图代次隔离异步分页，并按宿主 seq 排序去重；没有 seq 的兼容事件保留来源顺序，不按相同文本删除事件。通知链接保留目标至定位、明确解决或用户关闭提示；恢复失败/暂无目标会显示核对说明。E2EE 握手、令牌格式、RPC 白名单与持久设备存储不变。
