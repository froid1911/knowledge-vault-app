# Desktop Knowledge Vault — Phase 1-lite: launcher polish, Settings, Workflow Studio

**Goal:** The app behaves like a finished launcher: the landing stays the front door (no app-level
sidebar — see the Six Minds reasoning recorded in the ledger), vaults can be renamed and deleted,
Settings is a full-page view with a sections list, Workflow Studio opens full-view on an engine-created
Workflows drive, and external pages open in the system browser (done in `d2424ba`).

**Architecture:** Three landmarks that never move — the landing header (app name · Workflows · ⚙), the
in-workspace app bar (← Vaults · title · ⚙), and the Settings sections list. A tiny history-based router
(`/`, `/vault/:id`, `/workflows`, `/settings/:section`). The control API grows the few routes the shell
needs; the host never talks GraphQL for management (reads of the graph index excepted).

**Deferred (unchanged):** Renown sign-in and protection (Plan 1 Tasks 2–3), the pipeline's use of the model
key and the pipeline template (Plan 2), remote vaults (Plan 3).

**Spec:** §5.2 screens (updated: no sidebar; Settings sections; Workflows entry), §5.6 config file,
§5.7 landing, §5.8 webview integration.

## Review Focus
1. **Deleting a vault removes the drive and everything in it, and nothing else** — `deleteDocuments(propagate: CASCADE)` on the drive id only after the sidecar confirmed `preferredEditor === knowledge-vault`; the Workflows drive and non-vault drives are refused (404). Pinned by `vaults.test.ts` (variables + refusal) and `control.test.ts`.
2. **A typed confirmation guards delete** — the dialog's Delete button stays disabled until the vault's name is typed exactly. Pinned by `DeleteVaultDialog.test.tsx`.
3. **The API key never leaves the engine** — `GET /settings` returns `hasKey`, never the key; `PUT` with `apiKey: ""` clears it; the file is 0600. Pinned by `settings.test.ts`.
4. **The Workflows drive is created once** — `GET /workflows` is idempotent (`/d/workflows` first, create only if absent) and the drive never appears in the vault list. Pinned by `vaults.test.ts`.
5. **Full view inside a workspace** — vault and Workflow Studio screens render no landing chrome; the app bar carries the only way back and the gear. Pinned by the e2e (sidebar/landing header absent while a vault is open).

## Tasks

### Task 1 — Sidecar: management routes and richer status
- Modify `sidecar/src/vaults.ts`: `renameVaultDrive(origin, id, name)`, `deleteVaultDrive(origin, id)` (refuses non-vaults), `ensureWorkflowsDrive(origin)`; `sidecar/src/control.ts`: `PATCH /vaults/:id {name}`, `DELETE /vaults/:id`, `GET /workflows`, `GET /settings`, `PUT /settings`; `/status` gains `dataDir`, `stackVersion`, `vaultPackageVersion`.
- Create `sidecar/src/settings.ts`: `readSettings(dataDir)`, `writeSettings(dataDir, patch)` — `config.json` + `secrets/llm.key` (0600).
- Tests: `vaults.test.ts` (mutation variables, refusal, idempotent ensure), `settings.test.ts` (temp dir, key handling, 0600), `control.test.ts` (new routes with fake deps).

### Task 2 — Host: router, header, workspace screen, tile menus, dialogs
- Create `host/src/shell/router.ts` (+ test): `parseRoute(path)`, `routePath(route)`, `useRoute()`; `host/src/shell/Header.tsx` (app name · Workflows · ⚙); `host/src/shell/Dialog.tsx` (native `<dialog>`), `host/src/landing/RenameVaultDialog.tsx`, `host/src/landing/DeleteVaultDialog.tsx` (+ test: typed confirmation), `host/src/landing/VaultMenu.tsx` (⋯: Open · Rename · Delete), `host/src/shell/shortcuts.ts` (+ test: Ctrl/Cmd+N, Ctrl/Cmd+,, Esc).
- Modify `host/src/screens/VaultScreen.tsx` → `WorkspaceScreen` taking `appId` (`knowledge-vault` | `workflow-studio`), with ← Vaults · title · ⚙; `Landing.tsx` (header, menus, skeleton tiles, `renameVault`/`deleteVault` api); `App.tsx` (routes); `host/src/vaults.ts` (rename/delete/workflows/settings calls).

### Task 3 — Host: Settings view
- Create `host/src/screens/Settings.tsx` (sections list + outlet) and `host/src/settings/{Vaults,Appearance,Models,Workflows,Diagnostics,About,Identity}.tsx` (+ tests for Vaults delete flow, Models form, Appearance theme change).
- Vaults: list, rename, delete (same dialogs). Appearance: Dark/Light/System via reactor-browser `setTheme`. Models: endpoint/model/key → `PUT /settings`. Workflows: open Studio. Diagnostics: engine state, ports, data dir, "Connect your tools" copy block. About: app/stack/package versions. Identity: "Sign in arrives with the next phase."

### Task 4 — Workflow Studio full-view
- `/workflows` → `GET /workflows` → `WorkspaceScreen appId="workflow-studio"`; `installReactor` also calls `setSwitchboardUrl(graphqlUrl)` so the Studio's subgraph lookups resolve to the engine. Verified live (Studio renders its workflow list) and in the e2e.

### Task 5 — e2e, screenshots, live run
- e2e: landing → ⚙ → Settings sections; rename a vault from its ⋯ menu; delete the E2E vault with the typed confirmation; Workflows renders Studio; inside a vault no landing header is present. Screenshots of landing, settings, workflows for the critique pass. Live run with the user.

### Task 6 — docs and ledger
- Spec §5.2/§5.8 updated (no sidebar; Settings layout; Workflows entry; external browser done); Plan 1/2 adjusted for what exists; ledger entries; ledger copy under `docs/superpowers/ledgers/`.

## Done when
- A vault can be renamed and deleted (typed confirmation) from its tile and from Settings; the engine deletes the drive with its documents and the tile disappears.
- Settings opens full-page with its sections; Appearance switches the theme; Models persists endpoint/model/key (key stored 0600 in the engine's secrets, never returned); Diagnostics shows state, ports, data dir and the copy blocks; About shows the three versions.
- Workflows opens Workflow Studio full-view on the engine-created Workflows drive; the drive never appears as a vault.
- Inside a vault or Studio there is no landing chrome; ← Vaults and ⚙ are in the app bar.
- `bun run tsc`, `bun run test`, `bun run stack:check`, `cargo clippy`, `cargo test`, `bun run e2e` pass.
