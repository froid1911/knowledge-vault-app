# Desktop Knowledge Vault — Plan 4 (revised 2026-10-06) "Document conversion without Docker"

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native, chosen by the user). Stage A tasks are bite-sized TDD steps; Stage B is an outline to expand when Stage A has landed. Steps use `- [ ]` syntax.

**Goal:** Files a person adds (PDF, Word, slides, spreadsheets, Markdown) convert **on their computer**, with nothing to install for the common case and no Docker anywhere. Out of the box: text PDFs, Markdown and plain text. One click more (Stage B): the `docling.rs` binding (56–71 MB) for Office formats, then the PDF models (~700 MB) for scanned PDFs, images and OCR. A remote conversion service by URL stays available for teams. The user decided on 2026-10-06: **no Docker tier** — a person who runs the container points the app at it by URL.

**Architecture.**
- **The converter is the user's own service**, `@powerhousedao/docling-service` (repo `../docling`: `src/server.ts` + `*.mjs`), vendored into `sidecar/converter/` by `scripts/sync-converter.mjs` (like `sync:vault`), and run by the app's bundled Node as a **second helper process** — same contract the vault's `convert` subgraph already speaks (`GET /health`, `POST /convert?filename=…`, `GET /progress/:job`). It loads `docling.rs` lazily, so it starts with nothing installed; Stage B resolves the binding and `sharp` from `<dataDir>/converter/node_modules` through a loader hook.
- **Service change (docling repo, Task 1):** a *no-binding mode*. Today `/health` answers 503 and `/convert` fails when the binding is absent; the pdf.js text-layer rung exists only as a fallback for garbled docling output. The change makes the service answer `ok: true, binding: false` and convert `pdf` (text layer), `md`/`markdown`/`txt` (passthrough) with a local heading-based chunker; other formats answer 415 `BINDING_REQUIRED` with the remedy. `CONVERT_DISABLE_BINDING=1` forces the mode for tests and diagnostics. The container benefits too.
- **Package change (bai-knowledge-note, Tasks 2–3):** (a) **open-mode guard** — `requireUser` in `subgraphs/http/lib/authorize.ts` and its mirror `subgraphs/convert/lib/authorize.ts` accept an anonymous caller only when `ctx.authEnabled === false` **and** `KNOWLEDGE_VAULT_OPEN_MODE=1` is in the engine's environment (the sidecar sets it in open mode); the actor is the engine's own identity (`KNOWLEDGE_VAULT_OPEN_MODE_ADDRESS`, falling back to `local`). A hosted deployment that merely runs with auth off is unchanged (spec §7.3 said "follows the auth setting"; the explicit opt-in is a ruling: cost if wrong — none for the desktop, hosted stays closed). (b) **runtime conversion service** — `ConvertSubgraph` keeps its live route deps in a module slot; `setConversionServiceUrl(url | null)` swaps the service per request (no restart); the same setter is published on `globalThis[Symbol.for("@powerhousedao/knowledge-note/convert")]` for the same-process host; `convert/health` reports `source: "env" | "runtime" | null`.
- **Sidecar (Task 4):** `converter.ts` manages the helper (free loopback port, env from the allowlist + `CONVERT_SERVICE_HOST/PORT`, `DOCLING_RS_HOME=<dataDir>/converter/models`, log to `logs/converter.log`, health poll, one automatic restart, then `down`); settings `conversion: { mode: "local" | "remote" | "off", remoteUrl }` (default `local`) in `config.json`; applying a setting starts/stops the helper and calls the package setter; control `GET /converter`, `POST /converter/restart`, `PUT /settings { conversion }`.
- **Host (Task 5):** Settings › **Conversion** (after Models): state, what converts now (derived from health), the mode control (*On this computer* / *Another server* / *Off*), URL field, Save, Restart. Stage B adds Install/Remove for the binding and models.

**Tech:** `pdfjs-dist ^6.3.289` (added to the sidecar), Node ≥ 24 type stripping to run `server.ts` as-is, `docling.rs` 1.100.x (Stage B), the npm registry's tarball + integrity metadata (Stage B), upstream's model manifest via the service's own `fetch-models.mjs` (Stage B).

**Spec:** §6 (tiers — rewrite: no Docker), §7.3 (open mode), §7.4 (runtime URL), §5.2 (Settings › Conversion), §9 (converter states), §13 (upstream: darwin binding — we build it ourselves in Plan 6). **Prerequisites:** Plans 0, 1-lite (landed).

## Global constraints
- Plans 0–1 constraints apply (loopback only, allowlisted environment, no telemetry, secrets 0600, read-back after writes).
- The vendored copy must equal `../docling/src` minus tests and fixtures: `bun run sync:converter` refreshes it; `bun run sync:converter -- --check` fails when it differs (a header records the source commit).
- The helper never binds anything but `127.0.0.1`; its port is chosen free at start and passed by environment; the engine learns the URL only through the setter.
- In open mode the engine's REST surface is anonymous **only** because the sidecar set `KNOWLEDGE_VAULT_OPEN_MODE=1`; protected mode never sets it.
- Copy: states *Ready · Starting · Stopped · Not responding*; what converts is one sentence derived from health, never a hard-coded list.

## Review Focus
1. **A scanned PDF in no-binding mode** answers 415 with `code: "NEEDS_CONVERTER"` and `needsOcr`-style guidance — never an empty source. Pinned by the service test with the scanned fixture.
2. **Hosted safety:** with `authEnabled: false` and the opt-in unset, `requireUser` still throws 401 — pinned in both guards' tests. The sidecar sets the opt-in only when `protected` is false — pinned in `config.test.ts`.
3. **Switching mode during a conversion:** the in-flight request finishes on the old service; the next request uses the new one (the routes read `deps.service` per request) — pinned by the package setter test.
4. **The helper dies:** one automatic restart; a second death within 30 s leaves state `down` with the exit code, the engine URL is cleared (health says `configured: false`), and *Restart* brings it back — pinned by `converter.test.ts` with a fake child.
5. **Drift between the vendored service and its source** fails the check script — pinned by `sync-converter.test.mjs`.

## Stage A — tasks

### Task 1 — docling service: no-binding mode (repo `../docling`, branch `feat/no-binding-mode`)
- [ ] Test (`src/server.nobinding.test.ts`, spawn with `CONVERT_DISABLE_BINDING=1`): `/health` → 200 `{ ok: true, backend: "pdfjs", binding: false, ready: false, formats: ["pdf","md","markdown","txt"] }`; `POST /convert?filename=notes.md` → 200 markdown passthrough, ≥1 chunk with `headings`; `POST /convert?filename=text.pdf` (fixture with a text layer) → 200 `textSource: "pdfjs"`, `pages ≥ 1`; `POST /convert?filename=scan.pdf` (no text layer) → 415 `code: "NEEDS_CONVERTER"`; `POST /convert?filename=a.docx` → 415 `code: "BINDING_REQUIRED"`.
- [ ] Run → fails (health 503 today).
- [ ] Implement in `server.ts`: `bindingAvailable()` (import probe, `CONVERT_DISABLE_BINDING` short-circuit); `localChunks(markdown)` (split on headings, ≤ 1,200 chars, `headings` path, `contextualized`); `conversionFromText` uses docling's chunker when present, `localChunks` otherwise; `handleConvert` branches to the no-binding path before `docling()`; `handleHealth` answers the no-binding shape with `binding: false`; `formatsWithoutBinding` constant.
- [ ] Run → passes; `bun run test`, `tsc`, `lint`; README/README.service.md: the no-binding mode and the flag. Commit `feat(service): run without the docling.rs binding — text PDFs, Markdown and plain text`.

### Task 2 — package: open-mode guard (`bai-knowledge-note`, branch `feat/desktop-host-mode`)
- [ ] Tests (`subgraphs/http/lib/authorize.test.ts`, `subgraphs/convert/lib/authorize.test.ts`): anonymous + `authEnabled: true` → 401; anonymous + `authEnabled: false` + opt-in unset → 401; anonymous + `authEnabled: false` + `KNOWLEDGE_VAULT_OPEN_MODE=1` → the open-mode user `{ address: <KNOWLEDGE_VAULT_OPEN_MODE_ADDRESS or "local">, chainId: 0, networkId: "local", appKey: "desktop-knowledge-vault" }`; a real user is returned unchanged.
- [ ] Run → fail. Implement `openModeUser(ctx)` in both files (mirrors, by design). Run → pass; `bun run tsc`, `bun run test`. Commit `feat(subgraphs): open-mode guard — anonymous callers are the engine's owner when the host opts in`.

### Task 3 — package: runtime conversion service
- [ ] Tests (`subgraphs/convert/runtime.test.ts` + extend `resolvers.test.ts`): `setConversionServiceUrl("http://127.0.0.1:5011")` makes `health` report `configured: true, source: "runtime"` and `POST convert` call the new base; `setConversionServiceUrl(null)` → `configured: false`; the global registry exists after `onSetup` and drives the same slot; env still works (`source: "env"`).
- [ ] Run → fail. Implement `subgraphs/convert/lib/runtime.ts`, wire `onSetup`, extend `routes/health.ts`, export from `subgraphs/index.ts`. Run → pass; `tsc`, `test`, `bun run build` (dist for the desktop). Commit `feat(convert): conversion service URL settable at runtime, with a same-process registry`.

### Task 4 — sidecar: converter manager, settings, control
- [ ] `scripts/sync-converter.mjs` (+ `--check`) and its test; `bun run sync:converter`; `pdfjs-dist` added to `sidecar/package.json`; `bun install`.
- [ ] Tests: `settings.test.ts` (conversion defaults, validation of `remoteUrl` for mode `remote`), `config.test.ts` (open-mode opt-in only when not protected), `converter.test.ts` (state machine with an injected spawner: start → ready, death → one restart → `down`, stop, apply(local/remote/off) calls the setter with the right URL), `control.test.ts` (`GET /converter`, `POST /converter/restart`, `PUT /settings` with `conversion`).
- [ ] Run → fail. Implement `sidecar/src/converter.ts`, extend `settings.ts`, `config.ts` (`KNOWLEDGE_VAULT_OPEN_MODE`, `..._ADDRESS`), `control.ts`, `main.ts` (start the helper per setting after the engine is up; call the package setter through the global registry; stop the helper on shutdown), `data-dir.ts` (`converter/`).
- [ ] Run → pass; `tsc`, `test`, `stack:check`; a hand boot: `/converter` → `ready`, engine `convert/health` → `{ configured: true, ok: true, source: "runtime" }`. Commit `feat(sidecar): the conversion helper — vendored docling service, settings, control routes`.

### Task 5 — host: Settings › Conversion
- [ ] Tests (`Settings.test.tsx`): the section is listed after Models; shows *Ready* and the derived sentence; switching to *Another server* reveals the URL field and saves `{ conversion: { mode: "remote", remoteUrl } }`; *Off* saves `mode: "off"`; *Restart* calls the API; a `down` state shows the exit code and the log path.
- [ ] Run → fail. Implement `host/src/settings/Conversion.tsx`, `host/src/vaults.ts` (`fetchConverter`, `restartConverter`, `conversion` in `AppSettings`/`SettingsPatch`), `shell/router.ts` (`conversion` section), `Settings.tsx`. Run → pass; `tsc`, `test`. Commit `feat(host): conversion settings`.

### Task 6 — e2e, docs, ledger
- [ ] `e2e/conversion.spec.ts`: Settings › Conversion shows *Ready*; anonymous `GET /api/@powerhousedao/knowledge-note/convert/health` → `{ configured: true, ok: true }`; `POST …/convert?filename=notes.md` → sections; `POST …/convert?filename=text.pdf` → `textSource: "pdfjs"`. `bun run sync:vault` first (rebuilt package).
- [ ] Spec: §6 rewritten (no Docker; the service as the helper; three install states), §7.3/§7.4 as built, §5.2 Settings list, §13 darwin row, §14 phase 4 text; plans README; ledger entries; this plan's Status.
- [ ] Gates: `cargo clippy/test`, `bun run tsc/test/stack:check/e2e`. Commit `docs: conversion as built (Stage A)`.

## Stage B — outline (expand when Stage A has landed)
- **Binding installer** (`sidecar/src/converter/install-binding.ts`): registry metadata for `docling.rs@<pinned>` and its platform package → tarball URLs + `dist.integrity`; download with `Range` resume into `<dataDir>/converter/downloads/`, verify sha512, extract into `<dataDir>/converter/node_modules/{docling.rs,docling.rs-<platform>}`; `sharp` the same way (its platform packages); manifest `converter/manifest.json`.
- **Models installer:** run the vendored `fetch-models.mjs` with `DOCLING_RS_HOME=<dataDir>/converter/models` as a child, parse its progress; it already verifies size + sha256 against upstream's manifest.
- **Loader hook** `sidecar/converter/resolve-hooks.mjs` (`module.register`, like `nodefs-hooks.mjs`): bare `docling.rs` / `sharp` → the install dir when present.
- **Control/UI:** `GET /converter` gains `installed: { binding, models }`, `POST /converter/install {component}`, `GET /converter/progress`, `POST /converter/remove`; Settings shows the two components with *Install (n MB) · Installing n % · Installed · Remove*; the state sentence grows accordingly.
- **Platform gate:** linux-x64/arm64 and win32-x64 offer the binding; darwin shows *The converter for macOS is coming — text PDFs, Markdown and plain text work now* until Plan 6 builds the darwin binding on the Mac runners and hosts it with our releases.
- **Memory:** *Off* and *Remove* free it; health reports `modelsLoaded`.

## Done when (Stage A)
- A fresh app: Settings › Conversion says *Ready — reads text PDFs, Markdown and plain text* with nothing downloaded; a text PDF dropped on intake becomes sections (`textSource: "pdfjs"`); a `.docx` answers with the remedy, not an empty source.
- *Another server* with a conversion service URL works; *Off* makes `convert/health` say `configured: false`; switching needs no engine restart.
- Open-mode REST routes answer anonymous callers on the local engine and still 401 on a hosted deployment without the opt-in.
- All gates and `bun run e2e` pass; spec and ledger describe what was built.

## Status
Stage A started 2026-10-06 (native execution).
