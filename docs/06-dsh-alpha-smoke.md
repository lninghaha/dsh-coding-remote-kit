# Isolated smoke on DSH `0.1.2-alpha.*` (cadence)

Tracker: [#12](https://github.com/lninghaha/dsh-coding-remote-kit/issues/12)

## Rules

- Use an isolated `DSH_HOME` under `/tmp` (never the operator profile).
- Install `@deepseek-ai/dsh@0.1.2-alpha.*` into a **prefix** CLI; do not overwrite the global `0.1.1-rc.2` pin.
- Bind the isolated `dsh web` to a **high port** (default `18382`); never take `3080` / `6879`.
- **Never** restart operator `dsh-web.service`.
- Comment results on #12 (Node / pnpm / DSH / plugin versions + pass/fail). Do not paste secrets.

## Quick path

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use
pnpm run assert:node
pnpm run smoke:dsh-alpha
# or:
DSH_ALPHA_VERSION=0.1.2-alpha.5 WEB_PORT=18382 pnpm run smoke:dsh-alpha
```

## Manual checklist

1. Prefix-install CLI: `npm install --prefix /tmp/dsh-cli-$VER @deepseek-ai/dsh@$VER`
2. `DSH_HOME=/tmp/dsh-verify-remote-kit-$VER` + copy `pnpm run release:pack` tarball into `$DSH_HOME/packages/`
3. `dsh plugin --profile web add <tarball>` then `dsh web --port $WEB_PORT --no-open`
4. Assert `GET /m/` CSP includes `frame-ancestors 'none'` (or current kit policy)
5. Assert PIN claim is one-shot (second claim fails)
6. Assert WS auth limiter still trips after repeated bad auth
7. Kill only the smoke PID; leave operator services alone

Production BOM `verified` stays on `0.1.1-rc.2` until deliberately promoted.
