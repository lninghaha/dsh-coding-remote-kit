# 项目规则（dsh-mobile-remote）

本仓库是挂在生产 `dsh web` 上的 Cordis 插件。入口 `import` 失败会 **fail-fast 拖死整棵插件树**，表现为 3080 拒连、Caddy 502。下面规则对在本仓库干活的人和 agent 一律生效。

## 1. 禁止自行重启生产 dsh-web（强制）

Agent **不得**自行执行下列任何操作：

- `systemctl --user restart|stop|start|kill dsh-web.service`
- `dsh-web restart|start|stop` 或对 `dsh web` 进程 `kill` / `pkill`
- 为「让插件生效」而重启、重载、抢占 `127.0.0.1:3080`

重启会切断正在跑的 GUI 会话（包括当前 agent 自己）。挂回 / 卸包之后，**只准备材料并报告**，由操作者在自己选的时间窗重启。

允许的只读核对（重启后由操作者或下一轮会话执行）：

- `systemctl --user is-active dsh-web.service`
- `curl -sS -m 6 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/`
- `journalctl --user -u dsh-web.service` 查有无 `plugin tree failed`
- `ss -tlnp | grep -E '3080|6879'`

## 2. 挂回生产 profile 的分工

目标始终是 `DSH_HOME=/home/lning/.dsh` 的 **`web` profile**，不要写进 `~/dev/dsh/.dsh`。

| 谁 | 可以做 | 不可以做 |
|---|---|---|
| Agent | Docker 沙箱门禁、`pnpm pack`、把 tgz **拷到仓库外**（如 `~/.dsh/packages/`）、`dsh plugin --profile web add <tgz>`、只读探活、写运维日志 | 重启 `dsh-web`、`link:` 工作树、改 mihomo/Caddy/Tailscale |
| 操作者 | `touch/rm ~/.config/dsh-web-keepalive.off`、重启 `dsh-web`、确认 3080=200 后恢复保活 | — |

tarball **不要**放在本仓库根下再 `pnpm add`：pnpm 11 会把 `file:.../output/*.tgz` 解析成 `link:` 源码树。先拷到 `~/.dsh/packages/dsh-mobile-remote-<ver>.tgz` 再 add。

安装前门禁：`pnpm test:sandbox` 必须绿。未绿禁止改生产 profile。

## 3. 测试与本机红线

- 测试进 Docker 沙箱（`test-dsh-mobile-remote:*`），不要在本机抢 3080/7890 或对生产 `dsh web` 做冒烟。
- 遵守用户级 `~/.dsh/AGENTS.md`：不扰动 mihomo / DNS / Tailscale；Docker 不用 `--network host`、不挂敏感目录。
- 不要把交接文档、密钥、真实 token 写进 git。

## 4. 事故备忘

esbuild 把 `tweetnacl` 打进 ESM 入口会导致 `Dynamic require of "crypto" is not supported`。server bundle 必须 `packages: "external"`，构建断言与 `tests/bundle-externals.test.js` 不得删。
