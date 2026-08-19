# Changelog

All notable changes to `dsh-coding-remote-kit` are documented here, following the release loop in `docs/00-project-rules.md`. Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versioning follows [SemVer](https://semver.org/).

## Unreleased

## v0.1.0 - 2026-08-19

### Added

- First public release as **`dsh-coding-remote-kit`** (GitHub `lninghaha/dsh-coding-remote-kit`). The npm name `dsh-mobile-remote` is a different WeChat plugin and is not this project.
- M1 Cordis plugin skeleton (`mobile-remote`) with Settings classic-script and Docker sandbox gate.
- M2 E2EE pairing (QR + 8-digit PIN), LAN data plane on port 6879, phone page at `/m`.
- M3 allowlisted RPC (session observe, short prompt, approvals/questions) and management routes on loopback `dsh web`.
- Optional Cloudflare Quick Tunnel that exposes only the data plane (never port 3080).

### Documentation

- Numbered `docs/`, English + zh-CN READMEs, `INSTALL.md`, `CONTRIBUTING.md`, publish vs local-only split.
- Move esbuild entry scripts into `build/` and add GitHub Actions Docker CI.
- Replace machine-specific hostnames in tests and comments with `example.com` / `/tmp/example-project`.
