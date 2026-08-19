# 00 · Project Rules: Versions, Releases & Maintenance

> Applies to the `dsh-mobile-remote` open-source plugin repository.
> This file is the single source of truth for repo conventions and governs `README` plus the (future) release flow.
> Principle: **publish like any general open source project, and never leak development privacy.** Anything facing external users must be public, generic and durable; anything internal (accounts, hosts, tokens, paths, credentials) stays local and must never reach git or the packed artifact.

---

## 0. Open-Source Principles

### 0.1 Why we open source

This project is published so others can use, study, fork and improve a DeepSeek Harness **mobile companion** plugin — pair a phone to a desktop `dsh web` host, observe sessions, and perform a narrow set of write operations. Openness is a goal, not an accident of hosting.

### 0.2 License & attribution

- The project is **MIT**. Every contribution is licensed under the same terms (see `LICENSE`).
- This plugin is a community project. It is **not affiliated with, and is not endorsed by, DeepSeek**.
- Pin and audit third-party versions. Do not impersonate vendors or their official clients.

### 0.3 The hard boundary: no development-privacy leak

Open source does **not** mean publishing everything. The following must never reach git, the packed artifact, or any public channel:

- real credentials, tokens, passwords, API keys, private keys, `authorized_keys`;
- personal accounts, host aliases, exact machine paths, internal IPs, overlay DNS names;
- fault-investigation notes that describe a private machine or a specific personal incident (keep these in `docs/local/`).

When in doubt, **do not publish** — put the note in the local-only layer instead.

Public examples use only `example.com`, `127.0.0.1`, `YOUR_TOKEN`, and `$DSH_HOME`.

### 0.4 "Publishable documentation will be published"

Any document that is useful to contributors and free of development-privacy content **is expected to be published** (tracked in git, shipped via `files` when it belongs in the package, reachable from `README`). This includes architecture, install/usage, contributor/release rules, changelog, protocol, and the threat model. Documents that fail the §0.3 boundary check stay local-only.

### 0.5 Community commitments

- Welcome and respond to issues and PRs (see `CONTRIBUTING.md`).
- Keep a real changelog. Do not invent capabilities or pad releases.
- Keep git history atomic and conventional (§7); never commit secrets or mix unrelated concerns.
- Do not bulk-share accounts, resell quota, run a public relay of `dsh web`, or bypass paywalls.

---

## 1. Document Layers: Publish vs Local-only

Every document belongs to one of two layers, and the two never mix:

| Layer | Location | In git / package? | Examples | Requirements |
|---|---|---|---|---|
| **Publishable (public)** | Repo root: `README.md` + `README.zh-CN.md`, `CONTRIBUTING.md`, `INSTALL.md`, `CHANGELOG.md`, `LICENSE`, `AGENTS.md`, and explicitly promoted generic `docs/` files listed below | ✅ git; package `files` lists a subset | architecture, install, protocol, threat model, contribution & release rules | privacy-free; external-facing tone |
| **Local-only (personal)** | `docs/local/` — investigation, ops notes with host paths; `reference/` (vendored third-party source) | ❌ `.gitignore`, never in `files` | concrete fault debugging, absolute paths, profile names on one machine | ignored by git by default |

**Promoted `docs/` files (git-tracked):**

- `docs/00-project-rules.md` (this file)
- `docs/01-mvp-scope.md`
- `docs/02-architecture.md` + `docs/02-architecture.zh-CN.md`
- `docs/03-protocol.md`
- `docs/04-threat-model.md`
- `docs/05-cloud-relay.md`
- `docs/research/*` (historical research; git-tracked, **not** listed in package `files`)

**Hard constraints**

- `package.json` `files` contains **only** publishable docs; `docs/` must **not** be added wholesale.
- `.gitignore` keeps `docs/*` ignored except the promoted paths above. To promote a new doc, add a negation, `git add -f` if needed, and update this table plus `README`.
- Before adding any doc, ask: *does an unrelated contributor need to see this?* Personal hosts, tokens, and incident notes go to `docs/local/`.

---

## 2. Document Naming & Language

- Docs use `NN-<topic>.md`, numbered from `00` (`00-project-rules` is the fixed rule file — it is not re-versioned on every release).
- **A "new document version" exists when** substantive content changes, a doc is split/merged/added, or `README.md` / `INSTALL.md` must stay consistent.
- A document's version **is the package version** (see §3); there is no separate doc versioning scheme.

### Language policy

- **`README.md` is English-first.** `README.zh-CN.md` is the community translation. Both carry an identical language-switch line. Keep sections and version references in sync.
- Additional README translations (ja/ko/…) are welcome after the first public release; do not add a language-switch link until the file exists.
- Publishable docs under `docs/` are English-first when newly written. Existing Chinese design docs (`01`, `03`, `04`, `05`, research) stay Chinese until a dedicated translation pass. Architecture is bilingual (`02` + `02-architecture.zh-CN.md`).
- `docs/local/` may stay in whatever language the author prefers.

---

## 3. Versioning & The Release Loop

[Semantic Versioning (SemVer)](https://semver.org/): `MAJOR.MINOR.PATCH`. The project is currently `0.0.0` (pre-release).

| Change | Version action |
|---|---|
| New public capability / RPC method / pairing behaviour | minor (in the `0.x` phase this bumps the second digit) |
| Bug fix, docs wording, process patch | patch |
| Breaking change to config, wire protocol, or package exports | major (pre-1.0, handled case by case) |

**The documentation loop (mandatory even before the first npm publish):**

```text
new document version formed
   │
   ▼
CHANGELOG.md updated (entry under Unreleased, or folded into a version)
   │
   ▼
README.md + README.zh-CN.md synced
   │
   ▼
pnpm test:sandbox  (Docker check + isolated-install + verify)
   │
   ▼
commit the passing slice (conventional, atomic)
```

**First public release (not enabled yet):** bump `package.json` and `PLUGIN_VERSION` together, annotated tag `v<version>` on a clean tree, then publish only after maintainer approval. Do not add a tag-triggered npm workflow until Trusted Publishing is bound.

Never change user-facing docs without syncing README. Never tag from a dirty tree.

---

## 4. Packing (no auto-publish)

Installable artifacts are produced with `pnpm pack`. Copy the tarball **out of this repository** before `dsh plugin add` — pnpm 11 resolves `file:.../output/*.tgz` as a `link:` source tree, and a failed plugin `import` fail-fasts the whole `dsh web` tree.

There is no `scripts/release.mjs` yet. When one is added it must:

- validate changelog / version / packed file list;
- refuse local-only paths (`docs/local/`, `reference/`, credentials);
- **not** bump, commit, tag, push, or publish.

---

## 5. Keeping the Project Active

- Honest changelog: accumulate under `Unreleased`; fold into `## v<version>` on release; never pad.
- `pnpm test:sandbox` is the contributor and CI gate. Host-side `pnpm test` is for the sandbox image, not a shared developer workstation that already runs production `dsh web`.
- Docs/code in sync: a new RPC method or pairing behaviour updates `README`, `docs/02-architecture.md`, and `docs/03-protocol.md` before it is considered done.
- Security stance: the prohibitions in `docs/04-threat-model.md` are a hard line.

---

## 6. Pre-Release Self-Check (Privacy Line)

Before every real release (and before packing a tarball that will leave this machine):

- [ ] Packed files contain **nothing** matching `docs/local/`, `reference/`, host aliases, tokens, or absolute home paths.
- [ ] `README.md` / `INSTALL.md` reference only public, generic commands and `$DSH_HOME`.
- [ ] The `files` whitelist does **not** include the whole `docs/` directory.
- [ ] `CHANGELOG.md` matches the version being packed; pending notes folded from `Unreleased`.
- [ ] `pnpm test:sandbox` passes.
- [ ] `git status` is clean of leftover source, docs, or lockfile drift.
- [ ] `package.json` `exports` still includes `"./package.json": "./package.json"`.

---

## 7. Commits, Pushes, Tags & Host DSH

Contributor-facing wording lives in `CONTRIBUTING.md`. This section is the source of truth for maintainers.

### 7.1 Atomic conventional commits

- [Conventional Commits](https://www.conventionalcommits.org/): `type(optional-scope): summary` in the imperative. Types: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `build:`, `ci:`, `chore:`. Optional scopes such as `M3` or `dataplane` are fine.
- **One coherent concern per commit.** Do not mix unrelated docs, toolchain, and feature work.
- Build the tracked Dockerfile `check` / `verify` targets before the commit. Do not install, typecheck, test, or pack this plugin against the production `dsh web` on a shared host. The build context is filtered by `.dockerignore`; project-code `RUN` steps use `--network=none`. Never use privileged mode, credential mounts, the Docker socket, or host-directory bind mounts. Host networking is prohibited except for a documented, maintainer-approved preview fallback (this repo does not currently ship one).
- Generated `lib/` is **not** a committed artifact in this repository (unlike some sibling plugins). Rebuild it inside the sandbox / `pnpm build`; do not check it in.
- Secrets, credentials, tokens, private keys, `.env` files, host aliases, absolute machine paths, and local-only notes (`docs/local/`, `reference/`) never enter git (§0.3).

### 7.2 Host DSH boundary (mandatory)

This plugin mounts on a live `dsh web`. A failed `import` **fail-fasts the whole plugin tree** (port 3080 refuses connections).

Unless the maintainer explicitly requests it for the current operation:

- never install into, modify, stop, restart, or validate against a DSH instance already running on the shared host;
- never `systemctl --user restart|stop|start dsh-web`, never `dsh-web restart`, never kill the process on `127.0.0.1:3080`;
- never `dsh plugin add` a `link:` working tree.

Allowed for agents: Docker sandbox, `pnpm pack`, copy the tarball **outside** the repo (for example `$DSH_HOME/packages/`), `dsh plugin --profile web add <tgz>` when asked to prepare an install, read-only probes, ops logs. Restart remains an **operator** action.

Target profile is always `$DSH_HOME` (default `~/.dsh`) **web**, never a checkout-local `.dsh`.

### 7.3 Pushes and tags

- Feature branches are pushed as checkpoints at each milestone, not only when the PR is finished.
- Force-push is forbidden without **explicit approval**, including `--force-with-lease`, once a branch has been pushed. Never force-push `main` or a published tag.
- Day-to-day user-facing work accumulates under `CHANGELOG.md` → `## Unreleased`.
- A release folds `Unreleased` into `## v<version>`, bumps `package.json` and `PLUGIN_VERSION` to that same version, and creates an **annotated** tag `v<version>` on a **clean** tree. Do not move or reuse a published tag.
