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

`session.prompt` / `session.cancel` / `respond` 记审计 `rpc_write`，`detail` 只有 `{ method, sessionId }`。

## 推送信封

已认证连接上的服务端推送：

```
{ push, data, rpcId? }
```

`push`：`session.event` | `session.subscribed` | `approval.requested` | `approval.resolved` | `question.requested` | `question.resolved` | `session.queue` | `host.event`。

仅 `approval.requested` / `question.requested` 必带 `rpcId`（mux 帧外层原样保留），供 `respond` 回显。

mux 重连后手机需再 `session.subscribe` / `host.subscribe`。`session.queue` 的 items 只含 `id` / `placement` / 文本摘要。

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
