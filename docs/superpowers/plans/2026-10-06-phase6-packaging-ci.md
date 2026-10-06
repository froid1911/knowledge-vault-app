# Desktop Knowledge Vault — Phase 6 "Packaging and CI" Implementation Plan (outline — expand to bite-sized TDD steps before execution)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Interfaces, contracts and tests are fixed here; expand each task before execution.

**Goal:** `bun run build:app` produces the installer for the current platform; merging `dev` into `main` produces Linux `.AppImage`/`.deb` and macOS arm64/x64 `.dmg` on a GitHub Release with installer sizes and the pinned package/stack versions in the notes; every push runs the checks, e2e and the performance gates.

**Architecture:** The shell serves `host/dist` over loopback HTTP in production (`tauri-plugin-localhost` on `hostPort`), bundles Node as a per-target external binary verified by checksum, and ships the sidecar (compiled TypeScript + production `node_modules`) and the pipeline template as resources. The Node binary runs the sidecar from the resource directory with `cwd = sidecar/`. GitHub Actions does the same steps CI-side; the perf gate boots a generated vault and asserts the spec's thresholds.

**Tech Stack:** Tauri 2 bundler (`externalBin`, `resources`), `tauri-plugin-localhost`, Node 24 LTS official binaries, GitHub Actions (`ubuntu-22.04`, `macos-14`, `macos-13`), Playwright, the spike's measurement harness (`spike/bin/measure.sh`, adapted).

**Spec:** §11 (build, targets, branching, CI), §3.2 (host served over loopback), §12 (performance gates), §5.2 About versions. **Prerequisites:** Plans 0–5.

## Global Constraints
- Plans 0–5 constraints apply.
- Node version for bundling: **24 LTS** (the Switchboard's own Docker image uses `node:24`); downloaded from `https://nodejs.org/dist/v24.x.y/` with `SHASUMS256.txt` verification, cached in CI by version.
- External binaries are named per Tauri's rule: `src-tauri/binaries/node-x86_64-unknown-linux-gnu`, `node-aarch64-apple-darwin`, `node-x86_64-apple-darwin`.
- Resources: `sidecar/dist`, `sidecar/node_modules` (production install, `bun install --production --frozen-lockfile` in a staging copy), `sidecar/powerhouse.config.json`, `host/dist`; the installer size per target is printed and recorded in the release notes.
- The app icon is generated from `assets/vault-icon.png` (padded to a 1024 × 1024 transparent square) with `bunx @tauri-apps/cli icon`; no other icon source exists.
- `main` is the release branch: a push to `main` builds and publishes; `dev` and feature branches only run checks and e2e.
- No code signing or notarisation in this phase (macOS users right-click → Open once); documented in the README and the release notes.

## Review Focus
1. **The bundled Node must run on the oldest supported Linux** (glibc of ubuntu-22.04): build on 22.04, not latest — release workflow pins `ubuntu-22.04`; the `.AppImage` smoke test runs on a clean 22.04 container.
2. **A sidecar resource path with spaces** (`/Applications/Knowledge Vault.app/…`): the shell quotes nothing and passes paths as separate args; `cwd` handles spaces — Rust path test with a space in the resource dir.
3. **The host served over loopback must not be reachable from the LAN**: `tauri-plugin-localhost` binds `127.0.0.1` only — test that `0.0.0.0:<hostPort>` refuses from another interface (Linux CI with a second network namespace is overkill: assert the bind address in the plugin configuration and in `ss -ltn` output during the smoke test).
4. **Perf gate flakiness**: boot time is measured as the median of three cold starts, RSS as the minimum of three one-minute idle samples; thresholds boot ≤ 10 s, idle ≤ 1 GB on the generated ~2.5k-document vault.
5. **Release notes drift**: the package and stack versions in the notes come from `package.json` files at build time, never from a hand-edited string — `release-notes.mjs` test.

## Tasks (interfaces fixed; expand before execution)

### Task 1 — scripts: Node download with checksum, sidecar staging, icon generation
`scripts/fetch-node.mjs` (`--version 24.x.y --target <triple>` → `src-tauri/binaries/node-<triple>`; verifies against `SHASUMS256.txt`), `scripts/stage-sidecar.mjs` (copies `sidecar/dist`, `sidecar/powerhouse.config.json`, runs `bun install --production --frozen-lockfile` in `.stage/sidecar`, prunes `*.map`, `*.d.ts`, `test/`, `__tests__/`; prints the size), `scripts/make-icon.mjs` (`magick assets/vault-icon.png -background none -gravity center -extent 1024x1024 assets/vault-icon-1024.png` then `bunx @tauri-apps/cli icon assets/vault-icon-1024.png`). Tests: checksum verification rejects a tampered file; staging prune list.

### Task 2 — shell: production serving and resource paths
`tauri.conf.json`: `bundle.active: true`, `bundle.externalBin: ["binaries/node"]`, `bundle.resources: { "../.stage/sidecar/": "sidecar/", "../host/dist/": "host/" }`, `bundle.icon: ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"]`, `bundle.macOS.entitlements: "entitlements.plist"` (allows the external binary: `com.apple.security.cs.allow-unsigned-executable-memory` false, `com.apple.security.cs.disable-library-validation` true), `build.frontendDist: "../host/dist"`; `tauri-plugin-localhost` serving `host/` on `hostPort` bound to `127.0.0.1` (the window loads `http://127.0.0.1:<hostPort>`); in production `spawn_sidecar` uses `app.shell().sidecar("binaries/node")` with `args [resource_dir/sidecar/dist/main.js]` and `current_dir(resource_dir/sidecar)`; dev keeps system `node`. Tests: resource path assembly with spaces; dev/prod switch.

### Task 3 — host: version injection
`vite.config.ts` defines `__APP_VERSION__` (from root `package.json`), `__STACK_VERSION__` (from `@powerhousedao/reactor-browser` version in `host/package.json`), `__VAULT_PACKAGE_VERSION__` (from `@powerhousedao/knowledge-note/package.json`); About shows all three; `KV_APP_VERSION` passed to the sidecar by the shell comes from `CARGO_PKG_VERSION`, kept equal by `scripts/check-versions.mjs` (root `package.json`, `src-tauri/Cargo.toml`, `tauri.conf.json` must agree). Test for the agreement check.

### Task 4 — `bun run build:app` and the local smoke
Root script: `bun run build:host && bun run build:sidecar && node scripts/stage-sidecar.mjs && node scripts/fetch-node.mjs --target $(rustc -vV | sed -n 's/host: //p') && bunx @tauri-apps/cli build`. Smoke (`scripts/smoke-installer.sh`): install the `.AppImage` into a clean `ubuntu:22.04` container with `xvfb-run`, launch with `KV_SMOKE=1` (the shell exits 0 after the sidecar reports ready and the host answered `/`), assert exit 0 within 60 s, print installer size and RSS.

### Task 5 — perf gate
`perf/generate-vault.mjs`: against a fresh sidecar, create a vault and ~2,500 documents (2,000 notes with realistic bodies, 400 sources, 85 MoCs, relationships) through the vault's REST `POST notes`/`POST sources` and `POST relationships` routes; cache the resulting data dir in CI by generator hash. `perf/measure.mjs` (from `spike/bin/measure.sh`): three cold starts → median boot-to-GraphQL and index-ready; three one-minute idle RSS samples → minimum; assert ≤ 10 s and ≤ 1 GB; print a table. Runs on Linux CI only.

### Task 6 — GitHub Actions
`.github/workflows/ci.yml` (on push to `dev`/feature branches and PRs): checkout both repos? No — the desktop repo pins the **published** package in CI: `bun install --frozen-lockfile` with `@powerhousedao/knowledge-note` from npm (the `file:` link is for local work; CI fails if the lockfile still points at `file:`), then `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, `bun run tsc`, `bun run test`, `bun run stack:check`, `bunx playwright install --with-deps chromium`, `bun run e2e`, `node perf/measure.mjs` (Linux). `.github/workflows/release.yml` (on push to `main`): matrix `ubuntu-22.04` (x86_64-unknown-linux-gnu), `macos-14` (aarch64-apple-darwin), `macos-13` (x86_64-apple-darwin); steps: install Rust + bun, `bun install --frozen-lockfile`, `bun run build:host`, `bun run build:sidecar`, `node scripts/stage-sidecar.mjs`, `node scripts/fetch-node.mjs --target <triple>`, `tauri-apps/tauri-action@v0` with `tagName: v__VERSION__`, `releaseName: Knowledge Vault v__VERSION__`, `releaseBody` from `node scripts/release-notes.mjs` (installer sizes per target appended by a final job, package + stack versions), `prerelease: true` until signing exists. Caches: cargo registry, bun cache, node binaries, Playwright browsers, the perf vault.

### Task 7 — docs
README: install instructions per platform (macOS right-click → Open), where data lives, how to connect the CLI, how to build locally; CHANGELOG seeded from the release notes script.

## Done when
`bun run build:app` yields an installer that passes the clean-container smoke; `main` publishes Linux and macOS artefacts with sizes and versions in the notes; CI runs checks, e2e and the perf gate on every push; the app icon is the vault icon everywhere (window, dock/taskbar, installer).
