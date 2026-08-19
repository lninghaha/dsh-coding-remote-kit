# Contributing

Welcome! `dsh-mobile-remote` is an open-source DeepSeek Harness plugin for paired phone access. Read `docs/00-project-rules.md` first — it defines document layers, versioning, commit hygiene, and the host-DSH boundary.

## Code of Conduct

- Be respectful in issues, PRs and reviews.
- Only ever pair devices you own. The project does not support bulk accounts, quota resale, public relays of `dsh web`, or implying DeepSeek endorsement — see the security note in `README.md`.

## Getting started

Verification runs in an isolated Docker build sandbox. Do not run installs, builds, or tests directly against a shared host that already serves production `dsh web`. The tracked `Dockerfile` copies filtered source (never credentials), downloads dependencies in a dedicated stage, then runs project code with `--network=none`. Do not use privileged mode, credential or host-directory bind mounts, or the Docker socket. Tests use no published ports.

```bash
docker build --target check --build-arg NODE_VERSION=22.19.0 \
  --tag test-dsh-mobile-remote:check .

docker build --target isolated-install --build-arg NODE_VERSION=22.19.0 \
  --tag test-dsh-mobile-remote:isolated-install .

docker build --target verify --build-arg NODE_VERSION=22.19.0 \
  --tag test-dsh-mobile-remote:verify .
```

Wrapper (same images, plus leftover-container cleanup):

```bash
pnpm test:sandbox
```

Image name prefix is `test-dsh-mobile-remote:*`. Host networking is prohibited.

## Development flow

1. Open an issue (or link an existing one) so scope is agreed first.
2. Branch from the default branch. Keep commits atomic and conventional.
3. When you change a capability or add a doc, update `README.md` + `README.zh-CN.md` and the matching `docs/` file, **and** add a changelog entry under `Unreleased`.
4. Build Docker `check` and `verify` until green, then commit that passing slice promptly.
5. Push the branch as a milestone checkpoint and open a PR. Keep `docs/local/` out of the PR.

## Commits & pushes

### Conventional, atomic commits

- [Conventional Commits](https://www.conventionalcommits.org/): `type(optional-scope): summary` in the imperative, about 50–72 characters.
- Types: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `build:`, `ci:`, `chore:`.
- Optional scopes such as `M3` or `dataplane` are welcome.
- **One coherent concern per commit.**
- Do not rewrite published history. Amend or squash only on an unpushed local commit.

### Before you commit

- `pnpm test:sandbox` green. Do not commit a failing tree.
- Do not leave a finished, verified change sitting uncommitted next to later work.
- Generated `lib/` is **not** committed in this repository. Rebuild inside the sandbox.
- Never commit secrets, tokens, `.env` files, host-specific paths, or local-only notes (`docs/local/`, `reference/`).

### Pushing

- Push as a **checkpoint** at each milestone, not only when the PR is finished.
- Never force-push (`--force` / `--force-with-lease`) without **explicit maintainer approval**.
- Open the PR from a pushed checkpoint. Describe what changed and how it was verified.

## Host DSH boundary

A failed plugin `import` fail-fasts the whole `dsh web` tree (port 3080 down).

**Do not** restart, stop, or start production `dsh-web`. **Do not** `dsh plugin add` a `link:` checkout. Prepare a tarball copied outside the repo; the operator restarts.

Allowed: Docker sandbox, `pnpm pack`, copy to `$DSH_HOME/packages/`, read-only probes (`systemctl --user is-active`, `curl` to 3080), ops logs.

`package.json` `exports` **must** keep `"./package.json": "./package.json"`. Do not delete `tests/bundle-externals.test.js` or `tests/routes-unique.test.js`.

## Review & merging

- At least one other person's approval is needed to merge when a second reviewer exists; otherwise the maintainer reviews.
- A PR that changes public behaviour must not be merged without README/changelog updates.
- Do not force-push `main` or a published release tag.

## Reporting security issues

Do not open a public issue that includes tokens, pairing URLs, or device identifiers. Follow `docs/04-threat-model.md`; for anything sensitive, contact a maintainer directly.

## Document layers

- **Publishable**: root README family, `INSTALL.md`, `CHANGELOG.md`, `LICENSE`, `AGENTS.md`, `docs/00-project-rules.md`, `docs/01-mvp-scope.md`, `docs/02-architecture*.md`, `docs/03-protocol.md`, `docs/04-threat-model.md`, `docs/05-cloud-relay.md`, and `docs/research/` (research is git-tracked but not shipped in the npm `files` whitelist).
- **Local-only**: `docs/local/` and `reference/` are git-ignored and never shipped.

If you are not sure whether a detail is publishable, keep it in the local-only layer or ask a maintainer.
