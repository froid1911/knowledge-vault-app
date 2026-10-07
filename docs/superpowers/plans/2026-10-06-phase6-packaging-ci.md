# Desktop Knowledge Vault — Phase 6 "Packaging and CI" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `bun run build:app` produces an installer for this machine that starts the app with everything it needs (bundled Node, the engine, the host); the release workflow on `main` builds Linux `.AppImage`/`.deb` (on ubuntu-22.04) and macOS arm64/x64 `.dmg` with sizes and pinned versions in the notes; every push runs the checks and the e2e.

**Expanded 2026-10-07 from the outline, after a probe** (scratchpad, recorded in the ledger):
- A frozen, production, *hoisted* install of only the sidecar workspace works from a scratch copy of the workspace manifests + `bun.lock`: `bun install --production --frozen-lockfile --filter '@desktop-knowledge-vault/sidecar' --linker hoisted` — 1,194 packages in 4.6 s, **1.7 GB**, no dev tools (vitest, playwright, tauri CLI absent). `vite` and `typescript` are real dependencies of the stack (reactor-api, switchboard, knowledge-note) and stay.
- A **target-aware prune** — other platforms' native binaries (`onnxruntime-node/bin/*/{darwin,win32,linux/arm64}`, per-platform packages under `@img`, `@napi-rs`, `@rolldown`, `@oxfmt`, …) plus `*.map` and `*.d.ts` — brings it to **833 MB**. Pruning *directories by name* (`test/`, `docs/`) **breaks the engine** (`viem/_esm/actions/test` is code): never do it.
- **Node 24.21.0** (LTS, from nodejs.org, `SHASUMS256.txt` verified) runs the staged engine in a clean environment (`env -i`): ready in 13 s, vault created, converter helper ready, a Markdown file converted through the engine, graceful stop in 1 s.
- Staged engine + Node compress to **≈ 203 MB** (zstd -9) → a Linux installer of roughly 230 MB.
- `tauri-plugin-localhost` **2.4.0** (the Tauri 2 line) binds `host:port` with `.host("127.0.0.1")`, serves the embedded `frontendDist` (so `host/dist` is *not* a resource), and **panics if the port is taken** — the shell must pick a free port before building the app. A page loaded from `http://127.0.0.1:<port>` needs a capability with `remote.urls` to call the shell's commands.
- This machine has glibc 2.44: a locally built AppImage runs only on equally recent Linux. Portable Linux artefacts are built on ubuntu-22.04 (CI, or `scripts/build-linux-docker.sh` locally).

**Spec:** §11, §3.2, §12, §5.2. **Prerequisites:** Plans 0–5 (done); `@powerhousedao/knowledge-note` published (1.0.54-dev.24, pinned).

## Global Constraints
- Plans 0–5 constraints apply. bun locally; Node runs the engine.
- **Node 24.21.0** is pinned in `scripts/node-version.mjs` (one place); downloads are verified against `SHASUMS256.txt`, cached in `~/.cache/desktop-knowledge-vault/node/`.
- External binary per Tauri's rule: `src-tauri/binaries/node-<target-triple>` (`x86_64-unknown-linux-gnu`, `aarch64-apple-darwin`, `x86_64-apple-darwin`).
- The staged engine lives in `.stage/sidecar/` (`dist/`, `converter/`, `powerhouse.config.json`, `package.json`, `node_modules/`) and is bundled as the resource `sidecar/`. `.stage/` and `src-tauri/binaries/` are git-ignored.
- Staging and pruning run **on the target OS** (each CI runner stages its own), because native optional packages are installed for the machine that installs.
- Versions: root `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` carry the same app version (checked); About already shows app/stack/vault-package from the engine's `/status`.
- No signing/notarisation yet (macOS: right-click → Open once); release builds are marked prerelease.

## Review Focus
1. **Never prune by directory name**; prune only by platform and by file extension — the staging test pins both rules.
2. **Resource paths with spaces** (`/Applications/Knowledge Vault.app/…`): arguments are passed as separate args, `current_dir` takes the path as is — Rust test with a space.
3. **The host server binds 127.0.0.1 only**, on a port picked free before the app is built; the window, the navigation guard and `KV_HOST_ORIGIN` all use that port.
4. **Dev mode is untouched**: the localhost plugin is registered only in a release build (`cfg(not(dev))`); dev keeps system `node`, Vite and the dev loop.
5. **Release notes come from manifests** (app, stack, vault package versions; installer sizes measured), never hand-edited strings.

## Tasks

### Task 1 — Node download with checksum (`scripts/fetch-node.mjs`)
- [ ] Test (`scripts/lib/node-dist.test.mjs`): `nodeAsset("24.21.0", "x86_64-unknown-linux-gnu")` → `node-v24.21.0-linux-x64.tar.xz` + path `bin/node`; darwin arm64/x64 → `node-v24.21.0-darwin-{arm64,x64}.tar.xz`; unknown triple throws; `verifySha256(file, shasumsText)` accepts the listed hash and rejects a tampered file and a missing entry.
- [ ] Implement `scripts/lib/node-dist.mjs` + `scripts/node-version.mjs` + `scripts/fetch-node.mjs --target <triple>` (download to cache unless cached and verified, extract only `bin/node`, write `src-tauri/binaries/node-<triple>` mode 0755). Live: fetch for this machine, `--version` prints v24.21.0.
- [ ] Commit.

### Task 2 — Staging the engine (`scripts/stage-sidecar.mjs`)
- [ ] Test (`scripts/lib/prune.test.mjs`): on a fake tree, `prune(nm, "x86_64-unknown-linux-gnu")` removes `onnxruntime-node/bin/napi-v6/{darwin,win32}` and `linux/arm64`, `@img/sharp-darwin-arm64`, `@img/sharp-linuxmusl-x64`, `@napi-rs/canvas-win32-x64-msvc`, `*.map`, `*.d.ts`; keeps `@img/sharp-linux-x64`, `@napi-rs/canvas-linux-x64-gnu`, `viem/_esm/actions/test/x.js`, `pkg/docs/x.js`, `LICENSE`; for `aarch64-apple-darwin` keeps `@img/sharp-darwin-arm64` and `onnxruntime-node/bin/napi-v6/darwin/arm64`.
- [ ] Implement `scripts/lib/prune.mjs` and `scripts/stage-sidecar.mjs` (copy manifests + lockfile + bunfig/.npmrc to `.stage/ws/`, frozen production hoisted install filtered to the sidecar, assemble `.stage/sidecar/`, prune for the target, print the size). Live: stage, boot `.stage/sidecar` with the fetched Node in `env -i` on a scratch store → ready.
- [ ] Commit.

### Task 3 — The shell in a release build
- [ ] Tests (Rust): `config::resource_sidecar(resource_dir)` → `<resource>/sidecar/dist/main.js` (path with a space survives intact); `SidecarLaunch::for_build(packaged)` → packaged: program = the bundled `node` sidecar, cwd = `<resource>/sidecar`; dev: `node` on PATH, cwd = the repo's `sidecar/`.
- [ ] Implement: `Cargo.toml` + `tauri-plugin-localhost = "2.4"`; in `run()`, pick the host port free (default 4200) before the builder; `#[cfg(not(dev))]` register `tauri_plugin_localhost::Builder::new(port).host("127.0.0.1")`; the window loads `WebviewUrl::External(http://127.0.0.1:<port>)` in release, `default()` in dev; the navigation guard and `Ports.host` use that port; `spawn_sidecar` uses `app.shell().sidecar("node")` with the resource paths when packaged. `tauri.conf.json`: `bundle.active: true`, `externalBin: ["binaries/node"]`, `resources: { "../.stage/sidecar/": "sidecar/" }`, `bundle.linux.deb`/`appimage` defaults, `bundle.macOS.entitlements: "entitlements.plist"`; capability `remote.urls: ["http://127.0.0.1:*"]` for the main window; CSP stays `null` in this phase and is recorded as an open item (a CSP breaks the vault app in ways only the packaged app shows — needs its own pass with a CSP-enforcing e2e).
- [ ] `cargo clippy -D warnings`, `cargo test`; dev loop still works (`bun run dev` window shows the landing).
- [ ] Commit.

### Task 4 — `bun run build:app`, version check, smoke
- [ ] Test (`scripts/lib/versions.test.mjs`): `checkVersions({ pkg, cargo, tauri })` passes when equal, names each mismatch.
- [ ] Implement `scripts/check-versions.mjs`; root scripts `versions:check`, `build:app` = `versions:check && build:host && build:sidecar && stage-sidecar && fetch-node --target <host triple> && tauri build`; `scripts/smoke-app.mjs` — launches the built binary (AppImage on Linux, `.app` on macOS) with `KV_SMOKE=1` and a temp `XDG_DATA_HOME`/`HOME`; the shell, when `KV_SMOKE=1`, exits 0 once the engine is ready **and** the host page answered on its port (exit 1 after 90 s); prints installer size, time to ready and peak RSS. Live: `bun run build:app` on this machine, smoke passes.
- [ ] `scripts/build-linux-docker.sh`: the same build inside `ubuntu:22.04` (the CI image's glibc), artefacts copied out — optional locally, documented.
- [ ] Commit.

### Task 5 — CI and release workflows
- [ ] `.github/workflows/ci.yml` (push to any branch but `main`, PRs): ubuntu-22.04; install webkit/gtk build deps, Rust, bun; `bun install --frozen-lockfile`; `versions:check`, `stack:check`, `converter:check` (skipped when `../docling` is absent — CI has the vendored copy only), `cargo fmt --check`, `cargo clippy --all-targets -D warnings`, `cargo test`, `bun run tsc`, `bun run test`, `bunx playwright install --with-deps chromium`, `bun run e2e`. Fails if `bun.lock` contains a `file:` link.
- [ ] `.github/workflows/release.yml` (push to `main`): matrix ubuntu-22.04 / macos-14 / macos-13; stage + fetch-node per target; `tauri-apps/tauri-action@v0` with `tagName: v__VERSION__`, `prerelease: true`, body from `scripts/release-notes.mjs` (app/stack/vault-package versions from manifests, Node version, unsigned-macOS note); a final job appends each artefact's size.
- [ ] Test (`scripts/lib/release-notes.test.mjs`): notes contain the three versions read from fixture manifests and the Node version; sizes formatted in MB.
- [ ] Lint the YAML (`actionlint` if available, else parse with a YAML parser in a test). Workflows run once the repository exists on GitHub.
- [ ] Commit.

### Task 6 — Perf gate (deferred note) and docs
- [ ] `perf/` gate (spec §12: boot ≤ 10 s, idle ≤ 1 GB on a ~2.5k-document vault) is recorded as a follow-up with its design (generator through the vault's REST routes, median of three cold starts); not built in this phase — measured once by hand on the built app with the user's 2.8k-document snapshot instead, numbers in the ledger.
- [ ] README: install per platform (unsigned macOS: right-click → Open), where data lives (`~/.local/share/xyz.powerhouse.desktop-knowledge-vault/vault`, `~/Library/Application Support/…/vault`), connecting the CLI, building locally (`bun run build:app`, `scripts/build-linux-docker.sh`).
- [ ] Commit; ledger; plans index.

## Done when
`bun run build:app` produces an installer for this machine that passes `scripts/smoke-app.mjs` from a clean data folder; the release and CI workflows are in the repository (they run once it is on GitHub); all gates green.
