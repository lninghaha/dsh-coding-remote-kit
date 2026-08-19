import type { Locale } from "./locales.js";

export type MessageKey = keyof typeof MESSAGES;

/** Flat bilingual catalog. Keys are stable; values are zh-CN / en. */
export const MESSAGES = {
	"common.loading": { "zh-CN": "加载中…", en: "Loading…" },
	"common.cancel": { "zh-CN": "取消", en: "Cancel" },
	"common.close": { "zh-CN": "关闭", en: "Close" },
	"common.retry": { "zh-CN": "重试", en: "Retry" },
	"common.refresh": { "zh-CN": "刷新", en: "Refresh" },
	"common.gotIt": { "zh-CN": "知道了", en: "Got it" },
	"common.back": { "zh-CN": "返回", en: "Back" },
	"common.local": { "zh-CN": "本地", en: "Local" },
	"common.copyFailed": { "zh-CN": "复制失败", en: "Copy failed" },
	"common.language": { "zh-CN": "语言", en: "Language" },
	"common.lang.zh": { "zh-CN": "中文", en: "中文" },
	"common.lang.en": { "zh-CN": "English", en: "English" },
	"common.ago.justNow": { "zh-CN": "刚刚", en: "Just now" },
	"common.ago.minutes": { "zh-CN": "{n} 分钟前", en: "{n}m ago" },
	"common.ago.hours": { "zh-CN": "{n} 小时前", en: "{n}h ago" },
	"common.ago.days": { "zh-CN": "{n} 天前", en: "{n}d ago" },
	"common.remaining": { "zh-CN": "剩余 {time}", en: "{time} left" },
	"common.expired": { "zh-CN": "已过期", en: "Expired" },

	"brand.title": { "zh-CN": "DSH 远程", en: "DSH Remote" },
	"settings.nav": { "zh-CN": "移动远程", en: "Mobile Remote" },

	"settings.status.title": { "zh-CN": "数据面状态", en: "Data plane status" },
	"settings.status.reading": { "zh-CN": "正在读取…", en: "Loading…" },
	"settings.status.listening": { "zh-CN": "监听中", en: "Listening" },
	"settings.status.notListening": { "zh-CN": "未监听", en: "Not listening" },
	"settings.status.lanOpen": { "zh-CN": "已开放局域网", en: "LAN open" },
	"settings.status.loopbackOnly": { "zh-CN": "仅本机回环", en: "Loopback only" },
	"settings.status.summary": {
		"zh-CN": "{listen} · 端口 {port} · {reach} · {n} 台在线",
		en: "{listen} · port {port} · {reach} · {n} online",
	},
	"settings.status.refresh": { "zh-CN": "刷新状态", en: "Refresh status" },
	"settings.status.readFailed": {
		"zh-CN": "无法读取移动远程状态",
		en: "Failed to read Mobile Remote status",
	},
	"settings.devices.readFailed": {
		"zh-CN": "无法读取已配对设备",
		en: "Failed to read paired devices",
	},
	"settings.intro": {
		"zh-CN": "用手机浏览器扫码，控制这台电脑上的 DSH。配对码大约 10 分钟有效。",
		en: "Scan with your phone browser to control DSH on this computer. Pairing codes last about 10 minutes.",
	},

	"settings.channel.title": { "zh-CN": "1. 手机怎么连", en: "1. How the phone connects" },
	"settings.channel.lan": { "zh-CN": "同一 Wi‑Fi / 局域网", en: "Same Wi‑Fi / LAN" },
	"settings.channel.public": {
		"zh-CN": "外出（临时公网，不用 Cloudflare 账号）",
		en: "Away (temporary public URL, no Cloudflare account)",
	},
	"settings.channel.relay": {
		"zh-CN": "会合中继（自建 Worker，本机不开放端口）",
		en: "Rendezvous relay (self-hosted Worker; no open ports on this host)",
	},
	"settings.channel.publicHint": {
		"zh-CN": "公网地址等于一把临时钥匙，请勿转发。配对仍要扫码。不登录、不使用你的 Cloudflare token。",
		en: "The public URL is a temporary key — do not forward it. Pairing still requires a scan. No login and no Cloudflare token of yours.",
	},
	"settings.channel.needBinary": {
		"zh-CN": "外出需要官方 cloudflared（约几十 MB，装到本机 ~/.local/bin）。",
		en: "Away mode needs official cloudflared (~tens of MB) installed under ~/.local/bin.",
	},
	"settings.channel.downloading": { "zh-CN": "正在下载官方组件…", en: "Downloading official binary…" },
	"settings.channel.downloadBinary": {
		"zh-CN": "下载官方 cloudflared",
		en: "Download official cloudflared",
	},
	"settings.channel.nextOffer": {
		"zh-CN": "下一步点「生成二维码」时会自动打开临时公网。",
		en: "The next “Generate QR” will open a temporary public URL automatically.",
	},
	"settings.channel.running": { "zh-CN": "运行中", en: "Running" },
	"settings.channel.stopPublic": { "zh-CN": "停止公网", en: "Stop public tunnel" },
	"settings.channel.relayHint": {
		"zh-CN": "需要你自己的 Cloudflare 账号（Workers Paid）部署仓库里的 relay/。中继只转发密文，不要把 3080 指过去。",
		en: "Deploy relay/ with your Cloudflare account (Workers Paid). The relay forwards ciphertext only — never point 3080 at it.",
	},
	"settings.channel.tokenSaved": {
		"zh-CN": "已保存 HOST_TOKEN，留空则沿用",
		en: "HOST_TOKEN saved; leave blank to keep using it",
	},
	"settings.channel.disconnectRelay": { "zh-CN": "断开中继", en: "Disconnect relay" },
	"settings.channel.connecting": { "zh-CN": "正在连接…", en: "Connecting…" },
	"settings.channel.connectRelay": { "zh-CN": "连接会合中继", en: "Connect rendezvous relay" },
	"settings.channel.publicOpen": {
		"zh-CN": "公网已开：{host}",
		en: "Public tunnel up: {host}",
	},
	"settings.channel.relayConnectedLine": {
		"zh-CN": "中继已连：{host}",
		en: "Relay connected: {host}",
	},
	"settings.devices.phoneLine": {
		"zh-CN": "手机 · {ago} · {id}…",
		en: "Phone · {ago} · {id}…",
	},

	"settings.offer.title": { "zh-CN": "2. 生成二维码或配对码", en: "2. Generate QR or pairing code" },
	"settings.offer.preparing": { "zh-CN": "正在准备…", en: "Preparing…" },
	"settings.offer.generate": { "zh-CN": "生成二维码", en: "Generate QR" },
	"settings.offer.scanHint": {
		"zh-CN": "扫码，或在手机打开配对页后输入配对码。不要发到群里。",
		en: "Scan, or open the pairing page on the phone and type the code. Do not share in group chats.",
	},
	"settings.offer.copiedPin": { "zh-CN": "已复制配对码", en: "Pairing code copied" },
	"settings.offer.copyPin": { "zh-CN": "复制配对码", en: "Copy pairing code" },
	"settings.offer.pinExpired": {
		"zh-CN": "配对码已过期，请重新生成",
		en: "Pairing code expired — generate a new one",
	},
	"settings.offer.hideLink": { "zh-CN": "隐藏链接", en: "Hide link" },
	"settings.offer.showLink": { "zh-CN": "显示链接", en: "Show link" },
	"settings.offer.copiedLink": { "zh-CN": "已复制完整链接", en: "Full link copied" },
	"settings.offer.copyLink": { "zh-CN": "复制链接", en: "Copy link" },
	"settings.offer.regenerate": { "zh-CN": "重新生成", en: "Regenerate" },
	"settings.offer.needBinary": {
		"zh-CN": "请先下载官方 cloudflared",
		en: "Download official cloudflared first",
	},
	"settings.offer.failed": { "zh-CN": "生成二维码失败", en: "Failed to create pairing offer" },

	"settings.devices.title": { "zh-CN": "3. 已配对的手机", en: "3. Paired phones" },
	"settings.devices.empty": { "zh-CN": "还没有手机连过。", en: "No phones paired yet." },
	"settings.devices.revoked": { "zh-CN": "已吊销", en: "Revoked" },
	"settings.devices.online": { "zh-CN": "在线", en: "Online" },
	"settings.devices.offline": { "zh-CN": "离线", en: "Offline" },
	"settings.devices.confirmRevoke": { "zh-CN": "确认解除", en: "Confirm revoke" },
	"settings.devices.revoke": { "zh-CN": "解除配对", en: "Unpair" },
	"settings.devices.revokeFailed": { "zh-CN": "吊销设备失败", en: "Failed to revoke device" },

	"settings.tunnel.startFailed": { "zh-CN": "开启公网失败", en: "Failed to start public tunnel" },
	"settings.tunnel.stopFailed": { "zh-CN": "停止公网失败", en: "Failed to stop public tunnel" },
	"settings.tunnel.installFailed": {
		"zh-CN": "下载官方 cloudflared 失败",
		en: "Failed to download official cloudflared",
	},
	"settings.relay.startFailed": {
		"zh-CN": "会合中继连接失败",
		en: "Failed to connect rendezvous relay",
	},
	"settings.relay.stopFailed": {
		"zh-CN": "停止会合中继失败",
		en: "Failed to stop rendezvous relay",
	},
	"settings.error.withDetail": {
		"zh-CN": "{fallback}（{status}: {detail}）",
		en: "{fallback} ({status}: {detail})",
	},
	"settings.error.withHttp": {
		"zh-CN": "{fallback}（HTTP {status}）",
		en: "{fallback} (HTTP {status})",
	},

	"pair.loading.title": { "zh-CN": "正在配对…", en: "Pairing…" },
	"pair.loading.body": {
		"zh-CN": "正在与桌面建立端到端加密连接",
		en: "Establishing an end-to-end encrypted link with the desktop",
	},
	"pair.failed.title": { "zh-CN": "配对失败", en: "Pairing failed" },
	"pair.failed.serverRejected": {
		"zh-CN": "服务端拒绝配对（{code}）。",
		en: "Server rejected pairing ({code}).",
	},
	"pair.failed.unreachable": {
		"zh-CN": "无法连接桌面服务，请确认手机与电脑在同一网络。",
		en: "Cannot reach the desktop service. Confirm the phone and computer are on the same network.",
	},
	"pair.enterPin": { "zh-CN": "输入配对码", en: "Enter pairing code" },
	"pair.retryConnect": { "zh-CN": "重试连接", en: "Retry connection" },
	"pair.changeCode": { "zh-CN": "更换配对码", en: "Change code" },
	"pair.clearLocal": { "zh-CN": "清除本机配对", en: "Clear local pairing" },
	"pair.clearSaved": {
		"zh-CN": "清除本机已保存的配对",
		en: "Clear pairing saved on this phone",
	},
	"pair.cleared": {
		"zh-CN": "已清除，请重新扫码或输入配对码",
		en: "Cleared. Scan or enter a pairing code again.",
	},
	"pair.mismatch": { "zh-CN": "配对信息不符，已中止", en: "Pairing mismatch — aborted" },
	"pair.badHandshakeJson": {
		"zh-CN": "握手消息不是有效 JSON。",
		en: "Handshake message is not valid JSON.",
	},
	"pair.pubkeyMismatch": {
		"zh-CN": "服务端公钥与配对二维码钉死的公钥不一致。",
		en: "Server public key does not match the key pinned in the pairing QR.",
	},
	"pair.badHandshake": { "zh-CN": "握手消息无效。", en: "Invalid handshake message." },
	"pair.undecodable": { "zh-CN": "收到无法解码的消息。", en: "Received an undecodable message." },
	"pair.decryptAbort": {
		"zh-CN": "连续解密失败，连接已中止。",
		en: "Too many decryption failures — connection aborted.",
	},
	"pair.decryptFail": { "zh-CN": "无法解密服务端消息。", en: "Cannot decrypt server message." },
	"pair.badPayload": { "zh-CN": "收到无效的加密载荷。", en: "Received an invalid encrypted payload." },
	"pair.handshakeVerifyFail": { "zh-CN": "握手校验失败。", en: "Handshake verification failed." },
	"pair.wsError": {
		"zh-CN": "与桌面服务的连接出错。",
		en: "Error on the connection to the desktop service.",
	},
	"pair.disconnected.title": { "zh-CN": "连接已断开", en: "Disconnected" },
	"pair.disconnected.body": {
		"zh-CN": "与桌面的加密连接已关闭。可重试连接，或回桌面重新生成配对码。",
		en: "The encrypted link to the desktop closed. Retry, or regenerate a pairing code on the desktop.",
	},
	"pair.mobileTooOld.title": { "zh-CN": "版本过旧", en: "Version too old" },
	"pair.mobileTooOld.body": {
		"zh-CN": "手机端协议版本过旧，请更新插件后重试。",
		en: "This phone build is too old for the desktop. Update the plugin and retry.",
	},
	"pair.desktopTooOld.title": { "zh-CN": "桌面版本过旧", en: "Desktop too old" },
	"pair.desktopTooOld.body": {
		"zh-CN": "桌面端协议版本过旧，请更新 dsh 后重试。",
		en: "The desktop protocol is too old. Update dsh and retry.",
	},
	"pair.form.hint": {
		"zh-CN": "在桌面「移动远程」里生成二维码后，输入 8 位配对码；也可以直接扫码。",
		en: "After generating a QR under desktop Mobile Remote, enter the 8-character code — or just scan.",
	},
	"pair.form.connect": { "zh-CN": "连接", en: "Connect" },
	"pair.form.incomplete": {
		"zh-CN": "请输入完整的 8 位配对码",
		en: "Enter the full 8-character pairing code",
	},
	"pair.form.invalid": {
		"zh-CN": "配对码无效或已过期",
		en: "Pairing code invalid or expired",
	},
	"pair.form.submitFailed": { "zh-CN": "无法提交配对码", en: "Could not submit pairing code" },
	"pair.form.badFormat": { "zh-CN": "配对码格式不对", en: "Invalid pairing code format" },
	"pair.form.rateLimited": {
		"zh-CN": "尝试次数过多，请稍后再试",
		en: "Too many attempts — try again later",
	},
	"pair.qr.invalid": {
		"zh-CN": "配对二维码无效（{detail}）。",
		en: "Invalid pairing QR ({detail}).",
	},
	"pair.qr.parseFailed": { "zh-CN": "无法解析", en: "Could not parse" },

	"app.unknownTask": { "zh-CN": "未知任务", en: "Unknown task" },
	"app.unknownWorkspace": { "zh-CN": "未知工作区", en: "Unknown workspace" },
	"app.untitledSession": { "zh-CN": "未命名会话", en: "Untitled session" },
	"app.unboundWorkspace": { "zh-CN": "未绑定工作区", en: "Unbound workspace" },
	"app.unbound": { "zh-CN": "未绑定", en: "Unbound" },
	"app.sessionRunning": { "zh-CN": "任务会话 · 运行中", en: "Task session · running" },
	"app.sessionIdleCwd": { "zh-CN": "任务会话 · {cwd}", en: "Task session · {cwd}" },
	"app.session": { "zh-CN": "任务会话", en: "Task session" },
	"app.info": { "zh-CN": "信息", en: "Info" },
	"app.connectedWindow": { "zh-CN": "已连接到当前窗口", en: "Connected to this window" },
	"app.connectedPending": {
		"zh-CN": "已连接 · {n} 条待处理",
		en: "Connected · {n} pending",
	},
	"app.hint": {
		"zh-CN": "只能看到桌面窗口里已打开的项目。二维码失效后请回桌面重新连接。",
		en: "You only see projects already open in the desktop window. If the QR expires, reconnect from the desktop.",
	},
	"app.filterPlaceholder": {
		"zh-CN": "筛选工作区或任务",
		en: "Filter workspaces or tasks",
	},
	"app.workspacesTasks": { "zh-CN": "工作区和任务", en: "Workspaces & tasks" },
	"app.workspaceCount": {
		"zh-CN": "{workspaces} 个工作区 · {tasks} 个任务",
		en: "{workspaces} workspaces · {tasks} tasks",
	},
	"app.emptyDesktop": {
		"zh-CN": "桌面 DSH 窗口里还没有打开的项目或任务。请先在桌面打开工作区，再点右上角刷新。",
		en: "No open projects or tasks in the desktop DSH window. Open a workspace on the desktop, then refresh.",
	},
	"app.filterEmpty": {
		"zh-CN": "没有匹配「{query}」的会话，试试换个关键词。",
		en: "No sessions match “{query}”. Try another keyword.",
	},
	"app.pendingShort": { "zh-CN": "{n} 待处理", en: "{n} pending" },
	"app.taskCount": { "zh-CN": "{n} 个任务", en: "{n} tasks" },
	"app.newTask": { "zh-CN": "新建任务", en: "New task" },
	"app.noTasksInWorkspace": {
		"zh-CN": "这个工作区暂无任务",
		en: "No tasks in this workspace yet",
	},
	"app.running": { "zh-CN": "运行中", en: "Running" },
	"app.idle": { "zh-CN": "空闲", en: "Idle" },
	"app.showAllTasks": {
		"zh-CN": "显示全部 {n} 个任务",
		en: "Show all {n} tasks",
	},
	"app.sessionInfo": { "zh-CN": "会话信息", en: "Session info" },
	"app.task": { "zh-CN": "任务", en: "Task" },
	"app.workspace": { "zh-CN": "工作区", en: "Workspace" },
	"app.status": { "zh-CN": "状态", en: "Status" },
	"app.sessionId": { "zh-CN": "会话 ID", en: "Session ID" },
	"app.desktopOnly": {
		"zh-CN": "审查、终端与完整编辑器仅在桌面 DSH 侧栏提供；手机端负责观察、短回复与审批。",
		en: "Review, terminal, and the full editor stay on the desktop DSH sidebar; the phone observes, sends short replies, and handles approvals.",
	},
	"app.connectionInfo": { "zh-CN": "连接信息", en: "Connection info" },
	"app.connectionBody": {
		"zh-CN": "已与桌面建立端到端加密连接。待处理审批会显示在列表顶部。",
		en: "End-to-end encryption with the desktop is active. Pending approvals appear at the top of the list.",
	},
	"app.stopping": { "zh-CN": "停止中…", en: "Stopping…" },
	"app.stop": { "zh-CN": "停止生成", en: "Stop generation" },
	"app.composerPlaceholder": {
		"zh-CN": "继续给 Agent 发指令",
		en: "Send another instruction to the agent",
	},
	"app.send": { "zh-CN": "发送", en: "Send" },
	"app.openTask": { "zh-CN": "打开任务", en: "Open task" },
	"app.approval.title": { "zh-CN": "审批 · {tool}", en: "Approval · {tool}" },
	"app.allowOnce": { "zh-CN": "允许一次", en: "Allow once" },
	"app.deny": { "zh-CN": "拒绝", en: "Deny" },
	"app.answer": { "zh-CN": "回答", en: "Answer" },
	"app.submit": { "zh-CN": "提交", en: "Submit" },
	"app.allowed": { "zh-CN": "已允许", en: "Allowed" },
	"app.denied": { "zh-CN": "已拒绝", en: "Denied" },
	"app.answered": { "zh-CN": "已提交回答", en: "Answer submitted" },
	"app.refreshed": { "zh-CN": "已刷新", en: "Refreshed" },
	"app.requestFailed": { "zh-CN": "请求失败", en: "Request failed" },
	"app.role.you": { "zh-CN": "你", en: "You" },
	"app.role.assistant": { "zh-CN": "助手", en: "Assistant" },
	"app.role.tool": { "zh-CN": "工具", en: "Tool" },
	"app.taskLabel": {
		"zh-CN": "任务 {workspace}.{task}",
		en: "Task {workspace}.{task}",
	},
} as const satisfies Record<string, Record<Locale, string>>;

export function isMessageKey(key: string): key is MessageKey {
	return Object.prototype.hasOwnProperty.call(MESSAGES, key);
}
