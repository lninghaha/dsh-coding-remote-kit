# syntax=docker/dockerfile:1
# Base image for Cursor Cloud Agents working on dsh-coding-remote-kit.
# Pins the same toolchain the project targets: Node.js 22.19.0 (satisfies the
# package.json engines range) and pnpm 11.21.0 (matches packageManager).
FROM node:22.19.0-bookworm-slim

ENV NPM_CONFIG_UPDATE_NOTIFIER=false

RUN apt-get update \
	&& apt-get install -y --no-install-recommends git curl ca-certificates \
	&& rm -rf /var/lib/apt/lists/* \
	&& npm install --global pnpm@11.21.0

USER node
