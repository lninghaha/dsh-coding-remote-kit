# Isolated smoke on unverified DSH candidates

Tracker: [#12](https://github.com/lninghaha/dsh-coding-remote-kit/issues/12)

Use this cadence for hosts listed under `compatibility/dsh-bom.json` → `candidates[]` (today: `0.1.2-alpha.*`, `0.1.5-rc.1`). A candidate is **not** the production pin.

## Rules

- Use an isolated `DSH_HOME` under `/tmp` (never the operator profile).
- Prefix-install the candidate CLI (for example `@deepseek-ai/dsh@0.1.5-rc.1` or `@deepseek-ai/dsh@0.1.2-alpha.*`); do **not** overwrite the global verified `0.1.1-rc.2` pin.
- Bind the isolated `dsh web` to a **high port** (default `18382`); never take `3080` / `6879`.
- **Never** restart operator `dsh-web.service`.
- Comment results on #12 (Node / pnpm / DSH / plugin versions + pass/fail). Do not paste secrets.

## Quick path (`0.1.2-alpha.*`)

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use
pnpm run assert:node
pnpm run smoke:dsh-alpha
# or:
DSH_ALPHA_VERSION=0.1.2-alpha.5 WEB_PORT=18382 pnpm run smoke:dsh-alpha
```

## Manual checklist (any candidate, including `0.1.5-rc.1`)

1. Prefix-install CLI: `npm install --prefix /tmp/dsh-cli-$VER @deepseek-ai/dsh@$VER`
2. `DSH_HOME=/tmp/dsh-verify-remote-kit-$VER` + copy `pnpm run release:pack` tarball into `$DSH_HOME/packages/`
3. `dsh plugin --profile web add <tarball>` then `dsh web --port $WEB_PORT --no-open`
4. Authenticate the isolated Web UI the way the candidate host requires (for example cookie after `/?token=…` on `0.1.5-rc.1`)
5. Assert `GET /m/` CSP includes `frame-ancestors 'none'` (or current kit policy)
6. Assert PIN claim is one-shot (second claim fails)
7. Assert WS auth limiter still trips after repeated bad auth
8. Kill only the smoke PID; leave operator services alone

Production BOM `verified` stays on `0.1.1-rc.2` until deliberately promoted. Listing `0.1.5-rc.1` under `candidates[]` does not change that pin.
