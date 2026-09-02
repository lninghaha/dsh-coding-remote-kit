# Mobile page (M3)

手机浏览器页源码，`pnpm build` 产出到 `lib/mobile/`：

- `index.html` — 页面骨架（`<meta viewport>`，PWA manifest / apple-touch-icon，无外部 CDN）
- `manifest.webmanifest` / `sw.js` — 仅缓存 `/m` 静态壳，不碰 hash / WebSocket
- `main.ts` — 流程：读 `location.hash` → 解码配对 offer → 持久化完整 offer → 加载/生成
  手机 X25519 密钥 → `new WebSocket(endpoint)` → 4 步握手 → `status.get` → 版本门 → **保持 WS**
- `persist.ts` — 上次 offer 与 X25519 私钥写入 sessionStorage（同标签页刷新可重连；关闭标签即清除）
- `rpc.ts` — 请求/响应关联与推送分发
- `app.ts` — 会话列表、transcript、短回复、审批/提问卡片
- `e2ee.ts` — 手机侧握手与会话帧（tweetnacl + js-sha256 纯 JS HKDF；钉死服务端公钥）
- `dom.d.ts` — 最小浏览器全局声明（共享 tsconfig 不含 DOM lib）

数据面由 `lib/server/index.js` 在 `/m` 与 `/m/*` 提供本页，`cache-control: no-store`。断线显示「已断开，请刷新」。
