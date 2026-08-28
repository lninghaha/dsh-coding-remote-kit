# 安装与使用 · dsh-coding-remote-kit

本仓库是 DeepSeek Harness 的**社区**手机远程插件，宿主钉死 `@deepseek-ai/dsh@0.1.0-rc.6`。不暗示 DeepSeek 官方背书。

npm 包名是 **`dsh-coding-remote-kit`**。GitHub：[`lninghaha/dsh-coding-remote-kit`](https://github.com/lninghaha/dsh-coding-remote-kit)。npm 上的 `dsh-mobile-remote` 是另一个微信插件，不要装那个。

当前版本 **`0.5.1`**。

## 前置条件

- DeepSeek Harness `0.1.0-rc.6`
- Node.js 22.19+
- 本机已有常驻 DSH Web 进程（通常由操作者自己的服务管理器托管；不要另起一个抢 3080 的进程）
- 手机浏览器（v0 不是原生 App）

## 安装

```bash
# 普通用户：当前 npm 发布版
dsh plugin --profile web add dsh-coding-remote-kit@0.5.1

# 开发者：先过 Docker 沙箱门禁（不碰本机 3080 / $DSH_HOME）
pnpm test:sandbox
pnpm pack
mkdir -p "$HOME/.dsh/packages"
cp dsh-coding-remote-kit-0.5.1.tgz "$HOME/.dsh/packages/"
dsh plugin --profile web add "$HOME/.dsh/packages/dsh-coding-remote-kit-0.5.1.tgz"
```

## 升级注意事项

- 本版按已验证的 DSH BOM `@deepseek-ai/dsh@0.1.0-rc.6` 发布。`0.1.0-rc.7` 仍是候选版本，尚未纳入本版兼容声明。升级前先确认宿主版本，不要用 `*` 或未验证的宽泛范围替代精确版本。
- 从 `0.5.0` 升级到 `0.5.1`：每次 Start 会重新解析 `cloudflared`，`binaryOk` 按实时钉死校验；Settings 安装二进制后无需重载即可 Start。不重置配对设备、存储或凭据。
- 从 `0.4.x` 升到 `0.5.x`：`0.5.0` 新增连接诊断、公网隧道免责勾选与 cloudflared 钉死校验。当前请装 `0.5.1`（含上述能力）。不重置配对设备、存储或凭据。若仍在 `0.4.0`，请先经 `0.4.1`（或直接装 `0.5.1`）以避开严格 Cordis 注入检查下的启动失败。
- 在现有 **web profile** 中安装 `dsh-coding-remote-kit@0.5.1`（或对应 tarball），不要把 git checkout 直接作为插件源；这样可以避免 `link:` 源码树和旧包并存。
- 升级不会重置 `$DSH_HOME/storages/mobile-remote/`、已配对设备或凭据。安装完成后由操作者在维护窗口重启一次现有 DSH Web 进程，不要另起第二个实例。
- 如果同时升级 Hub 与 Subscription，先确保 npm 上的 `dsh-coding-oauth-core@0.1.0` 已可解析，再依次安装 Hub `1.9.1` 与 Subscription `0.6.1`；三包都更新后只重启一次。Core 是共享的 npm 依赖，不是需要单独 `dsh plugin add` 的 DSH 插件。共装时 Hub 负责完整界面，Subscription 收敛为状态入口。
- 回滚时只替换插件包版本，保留 profile、存储和凭据；先查看设置页兼容性诊断，只有诊断明确要求时才重新配对。不要为回滚删除 `storages/mobile-remote`。
- 远程 Settings 仍只能通过 SSH 隧道或完成属主鉴权的 HTTPS 反向代理访问；升级不会把 DSH 或数据面改为 `0.0.0.0`。

目标始终是 `$DSH_HOME`（默认 `~/.dsh`）的 **web profile**，不要写进某个 git checkout 里的 `.dsh`。

安装后由**操作者**通过测试机自己的服务管理器重启现有 DSH Web 进程。官方 `dsh web` 是启动 `web` profile 的 CLI 别名，不是 systemd 服务名；Agent 与自动化不得自行重启该进程或本机服务包装。

不要：

```bash
# 会变成 link: 源码树；入口 import 失败会拖死整棵 dsh web
dsh plugin --profile web add ./dsh-coding-remote-kit
```

## 配对

1. 打开 **设置 → 移动远程**。
2. 选择通道：**局域网**（默认）或 **公网**（Quick Tunnel，需显式开启）。
3. 生成配对 offer：设置页显示二维码与 8 位 PIN。
4. 手机扫描二维码打开 `/m#…`，或在手机页手输 PIN（`POST /m/claim`）。
5. 手机与数据面完成 E2EE 握手后，出现会话列表。

Offer 有 TTL（默认 10 分钟）。设备可在设置页吊销；吊销后该 `deviceToken` 不能再通过 `e2ee_auth`。

数据面默认 `127.0.0.1:6879`。广告 LAN 候选且没有公网隧道时，会 widen 到 `0.0.0.0`。有活跃 Quick Tunnel 时广告隧道 HTTPS origin，不再 widen。

## 公网隧道（可选）

默认关闭。设置页启动 Cloudflare Quick Tunnel 时：

- 必须先勾选免责声明；服务端要求请求体 `disclaimerAccepted: true`，否则拒绝启动
- `cloudflared` 的 `--url` **只**指向 `127.0.0.1:<数据面端口>`
- **禁止**把 `3080` / `dsh web` 送进隧道
- `/m` 会在 `https://<随机>.trycloudflare.com` 公开可达；没有 fragment / PIN 与 E2EE 仍不能读会话
- 把隧道 URL 当临时钥匙，不要转发
- 点「停止」或卸载插件必须杀掉子进程（`ctx.effect` disposer）

官方 `cloudflared` 二进制可在设置页按需安装，**不会**在 `apply()` 时自动下载。

## 会合中继（可选）

手机在 4G 且不想把本机 `6879` 打到公网时，可部署仓库里的 `relay/` Worker。桌面与手机都只出站；业务帧仍是 E2EE。需要 Cloudflare **Workers Paid**（Durable Objects）。本项目不运营公共会合点。

```bash
pnpm build
cd relay
pnpm install
npx wrangler types
npx wrangler secret put HOST_TOKEN
npx wrangler deploy
```

然后在 **设置 → 移动远程 → 会合中继** 填写 `https://example.com`（或 `https://<name>.workers.dev`）和同一 `YOUR_TOKEN`，连接后再生成二维码。规格见 [`docs/05-cloud-relay.md`](docs/05-cloud-relay.md)。

不要把 token 或真实域名写进 git。插件升级后必须重新 `pnpm build` 并 `wrangler deploy`。

## 推荐网络

按优先级：

1. Tailscale / WireGuard 等加密 overlay（缓解「裸 LAN 首次 HTTP 下发可被 MITM」）
2. 受信局域网
3. 用户显式开启的 Quick Tunnel
4. 自建会合中继（桌面出站，不开放本机端口）

不要把数据面端口直接映射到公网防火墙。

## 配置

`cordis.patch.yml` 默认：

```yaml
- insert:
    - id: mobile-remote
      name: dsh-coding-remote-kit
      config:
        enabled: true
        bind: "127.0.0.1"
        port: 6879
```

可选：`offerTtlMs`、`ownerRequest`。`trustedHosts` 仅为旧配置兼容保留，**不再授予远程管理权限**。

通过 SSH 本地端口转发访问 Settings 时，可显式标记服务端返回的访问方式：

```yaml
ownerRequest:
  loopbackAccessMode: ssh-tunnel
```

通过 HTTPS 反向代理访问 Settings 时，DSH 仍只绑定 loopback。反向代理必须先完成 owner 鉴权，再注入两份相互独立的秘密；插件同时核验真实 TCP peer、精确 Origin/Host、`Sec-Fetch-Site: same-origin`、owner proof 和变更请求 CSRF proof：

```yaml
ownerRequest:
  trustedProxy:
    peers: ["127.0.0.1"]
    origins: ["https://gui.example.com"]
    ownerProof: "YOUR_OWNER_PROOF"
    csrfToken: "YOUR_INDEPENDENT_CSRF_TOKEN"
```

代理注入头分别为 `X-DSH-Owner-Proof` 与 `X-DSH-CSRF-Token`。不要把示例占位符直接投入使用，不要把秘密下发给浏览器 JavaScript，也不要依赖 `X-Forwarded-*` 或公开的插件标记代替 owner 鉴权。任一项缺失时远程 Settings 会 fail closed，本机 loopback/SSH 仍可用于修复配置。

若同机反向代理的实际 peer 也是 loopback，并被列入 `peers`，来自该地址的所有请求都会按代理流量校验，不能回退成本地请求；这可阻止反代改写 `Host` 后绕过 proof。启用前应保留独立的 SSH 修复通道，反代必须保留公开 `Host`。

存储目录：`$DSH_HOME/storages/mobile-remote/`（目录 0700，文件 0600）。

## 故障排查

| 现象 | 常见原因 |
|---|---|
| 设置里没有「移动远程」，但 6879 在听 | `package.json` `exports` 缺少 `"./package.json"` |
| `dsh web` 整棵挂掉 / 3080 拒连 | 插件入口 `import` 失败（例如把 `tweetnacl` 打进 ESM），或同一 path `register` 两次 |
| 手机打不开 `/m` | 数据面未 widen / 未开隧道；或扫的是过期 offer |
| 握手失败 | 服务端公钥与 offer 不一致、token 已吊销、时钟/协议版本不兼容 |

只读核对（重启之后，由操作者或下一轮会话执行）：

DSH 官方不定义统一的服务单元名；请通过测试机实际配置的进程管理器检查现有 DSH Web 进程，再执行回环探活：

```bash
curl -sS -m 6 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/
```

不要为了「让插件生效」去杀 3080 上的进程。
