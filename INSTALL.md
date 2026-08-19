# 安装与使用 · dsh-coding-remote-kit

本仓库是 DeepSeek Harness 的**社区**手机远程插件，宿主钉死 `@deepseek-ai/dsh@0.1.0-rc.7`。不暗示 DeepSeek 官方背书。

npm 包名是 **`dsh-coding-remote-kit`**。GitHub：[`lninghaha/dsh-coding-remote-kit`](https://github.com/lninghaha/dsh-coding-remote-kit)。npm 上的 `dsh-mobile-remote` 是另一个微信插件，不要装那个。

当前版本 **`0.3.0`**。

## 前置条件

- DeepSeek Harness `0.1.0-rc.7`
- Node.js 22.19+
- 本机已有常驻 `dsh web`（不要另起一个抢 3080 的进程）
- 手机浏览器（v0 不是原生 App）

## 安装

```bash
# 普通用户：当前 npm 发布版
dsh plugin --profile web add dsh-coding-remote-kit@0.3.0

# 开发者：先过 Docker 沙箱门禁（不碰本机 3080 / $DSH_HOME）
pnpm test:sandbox
pnpm pack
mkdir -p "$HOME/.dsh/packages"
cp dsh-coding-remote-kit-0.3.0.tgz "$HOME/.dsh/packages/"
dsh plugin --profile web add "$HOME/.dsh/packages/dsh-coding-remote-kit-0.3.0.tgz"
```

目标始终是 `$DSH_HOME`（默认 `~/.dsh`）的 **web profile**，不要写进某个 git checkout 里的 `.dsh`。

安装后由**操作者**重启现有 `dsh web`。Agent 与自动化**不得**自行 `systemctl --user restart dsh-web` 或 `dsh-web restart`。

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

可选：`offerTtlMs`、`trustedHosts`（回环 TCP 时额外允许的 Host，例如反代）。

存储目录：`$DSH_HOME/storages/mobile-remote/`（目录 0700，文件 0600）。

## 故障排查

| 现象 | 常见原因 |
|---|---|
| 设置里没有「移动远程」，但 6879 在听 | `package.json` `exports` 缺少 `"./package.json"` |
| `dsh web` 整棵挂掉 / 3080 拒连 | 插件入口 `import` 失败（例如把 `tweetnacl` 打进 ESM），或同一 path `register` 两次 |
| 手机打不开 `/m` | 数据面未 widen / 未开隧道；或扫的是过期 offer |
| 握手失败 | 服务端公钥与 offer 不一致、token 已吊销、时钟/协议版本不兼容 |

只读核对（重启之后，由操作者或下一轮会话执行）：

```bash
systemctl --user is-active dsh-web.service
curl -sS -m 6 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/
```

不要为了「让插件生效」去杀 3080 上的进程。
