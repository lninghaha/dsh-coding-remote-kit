# syntax=docker/dockerfile:1.7
#
# Isolated install gate for dsh-mobile-remote. Reproduces the DSH loader path
# (`import(packageName)` of the packed ESM entry) without touching the host
# ~/.dsh profile or port 3080. Test images: test-dsh-mobile-remote:*
#
# Targets: check, isolated-install, verify.

ARG NODE_VERSION=22.19.0

FROM node:${NODE_VERSION}-bookworm-slim AS toolchain
ENV CI=1 \
	DSH_HOME=/tmp/dsh-sandbox-home \
	NPM_CONFIG_UPDATE_NOTIFIER=false
RUN npm install --global pnpm@11.21.0
WORKDIR /workspace
RUN mkdir -p "${DSH_HOME}" && chown -R node:node /workspace "${DSH_HOME}"
USER node

FROM toolchain AS dependencies
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS source
COPY --chown=node:node . .

FROM source AS check
RUN --network=none pnpm build && pnpm test

FROM check AS isolated-install
RUN --network=none pnpm pack \
	&& mkdir -p /tmp/consumer \
	&& printf '{"name":"dsh-mobile-remote-sandbox-consumer","private":true,"type":"module"}\n' > /tmp/consumer/package.json \
	&& cd /tmp/consumer \
	&& pnpm add --offline --ignore-scripts /workspace/dsh-mobile-remote-0.0.0.tgz \
	&& node --input-type=module -e "const m = await import('dsh-mobile-remote'); if (m.name !== 'mobile-remote' || typeof m.apply !== 'function' || !Array.isArray(m.inject)) process.exit(1); console.log('ok', m.name, m.inject, typeof m.apply);"

FROM isolated-install AS verify
