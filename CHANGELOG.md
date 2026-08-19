# Changelog

All notable changes to `dsh-mobile-remote` are documented here, following the release loop in `docs/00-project-rules.md`. Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versioning follows [SemVer](https://semver.org/).

## Unreleased

### Documentation

- Restructure the repository on the same document layers as `dsh-coding-subscription-oauth`: numbered `docs/`, English + zh-CN READMEs, `INSTALL.md`, `CONTRIBUTING.md`, publish vs local-only split, and `AGENTS.md` without machine-specific paths.
- Move esbuild entry scripts into `build/` and keep sandbox/e2e wrappers in `scripts/`.
- Add GitHub Actions CI that runs the isolated Docker `verify` / `isolated-install` targets.
- Replace machine-specific hostnames and home paths in docs, comments, and test fixtures with `example.com` / `/tmp/example-project`.

## v0.0.0 - 2026-08-19

### Added

- M1 Cordis plugin skeleton (`mobile-remote`) with Settings classic-script and Docker sandbox gate.
- M2 E2EE pairing (QR + 8-digit PIN), LAN data plane on port 6879, phone page at `/m`.
- M3 allowlisted RPC (session observe, short prompt, approvals/questions) and management routes on loopback `dsh web`.
- Optional Cloudflare Quick Tunnel that exposes only the data plane (never port 3080).
