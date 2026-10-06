# Desktop Knowledge Vault — Phase 5 "Resilience" Implementation Plan (outline — expand to bite-sized TDD steps before execution)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Interfaces, contracts and tests are fixed here; expand each task before execution.

**Goal:** The app survives what desktops do to it: engine crashes, upgrades, full disks, two instances, stale locks, long absences — and the user can back up, restore, export and delete their data, see what the engine is doing, and keep it running in the tray.

**Architecture:** The Rust supervisor owns restarts with backoff and publishes every state change as `sidecar:status`; the store's compatibility is guarded by the stack version recorded in `config.json` and an automatic backup before any stack bump; backups are a quiesced copy of the data dirs; exports reuse the vault's REST surface; the tray keeps the engine serving the CLI and agents while the window is closed; a single-instance lock prevents two engines on one store.

**Tech Stack:** Tauri plugins `single-instance`, `window-state`, `opener`, `dialog`, tray via the `tray-icon` feature; `zip` crate for backups; GitHub Releases API for the update notice.

**Spec:** §9 (all), §5.2 (Vaults: back up/restore/export/delete, Diagnostics: open logs, copy diagnostics; About: update notice), §5.8 (window, tray), §4.6 (`POST /shutdown`). **Prerequisites:** Plans 0–4.

## Global Constraints
- Plans 0–4 constraints apply.
- Backups are written to `backups/<ISO date>-<stackVersion>/` as one zip (`reactor/`, `read-model/`, `attachments/`, `config.json`, `pipelines.json`; never `secrets/`), only while the engine is stopped (quiesced), with a free-space check (≥ 2 × store size) first.
- A store written by a newer stack than the app's is **never** opened; the message names both versions and the download page.
- "Delete all local data" needs the typed word `delete`, stops the engine first, removes the app-data directory except `backups/` unless the user also ticks "including backups".
- Diagnostics output never includes secrets, tokens, or document content — only versions, ports, sizes, states and the last 200 log lines.
- Copy: "Reconnecting…", "The engine stopped. Open logs", "Back up vault", "Restore from backup", "Export as documents", "Delete all local data", "A newer version is available: 0.2.0 — Download".

## Review Focus
1. **Crash loop**: three failed restarts within two minutes stop the supervisor with "The engine keeps stopping" and the log tail — Rust `backoff.rs` test (1 s, 4 s, 16 s, then give up).
2. **Disk full during a backup**: the partial zip is removed and the error names the free space needed — Rust `backup.rs` test with a tiny fake quota.
3. **Upgrade with a running pipeline**: the auto-backup happens before the new stack opens the store; a run in flight at shutdown is recorded as interrupted by the runtime, and the UI explains "A processing run was interrupted by the update; it will be retried." — e2e in Phase 6's upgrade test.
4. **Second instance launched** (double-click twice): the first window is focused, no second engine starts — `single-instance` wiring test (manual on Linux; automated on CI via `tauri-driver` launching twice).
5. **Clock skew / future-dated backups**: restore lists backups by name, not by file mtime; a backup from a newer stack is refused with the same message as a newer store — `backup.rs` listing test.

## Tasks (interfaces fixed; expand before execution)

### Task 1 — shell: supervisor with backoff and crash reporting
`src-tauri/src/supervisor.rs`: state machine `Starting → Ready → (Exited(code) → Restarting(n) → Starting) | GaveUp`; delays 1 s, 4 s, 16 s; `sidecar:status` payload gains `attempt` and `logTail: Vec<String>` (last 50 lines kept in a ring buffer from the child's stdout/stderr); host banner states "Reconnecting…" and "The engine stopped — Open logs". Tests: backoff sequence; ring buffer; give-up after three failures within 120 s.

### Task 2 — shell: store guard and automatic backup before a stack bump
`src-tauri/src/store_guard.rs`: `compare(app_stack: &str, store_stack: &str) -> Ok | NeedsBackup | TooNew`; on `NeedsBackup` → `backup::create(data_dir, tag)` then start with `PH_MIGRATE_PGLITE=true`; on `TooNew` → refuse with the message. `src-tauri/src/backup.rs`: `create(data_dir, tag) -> BackupInfo { path, bytes, stackVersion }` (zip, excludes `secrets/`, free-space check), `list(data_dir) -> Vec<BackupInfo>` (by name), `restore(data_dir, path)` (quiesce engine, move current dirs to `backups/pre-restore-<date>/`, unzip, restart). Tests on temp dirs.

### Task 3 — sidecar: `POST /shutdown`, export, stale-lock cleanup, log rotation
Control `POST /shutdown` (SIGINT path); `GET /vaults/:id/export` streams a zip of every document's state + operations as JSON (the drive-sync format: `documents/<id>.json`, `tree.json`) plus `llms-full.txt` from the REST surface; `main.ts` removes `postmaster.pid` in both data dirs when no process holds the dir (checked with a lock file `engine.lock` written by the shell); logs to `logs/sidecar.log` through a rotating writer (10 MB × 5). Tests: export manifest shape with a fake reactor; rotation.

### Task 4 — host: Diagnostics (open logs, copy diagnostics), Vaults (back up, restore, export, delete), update notice
`host/src/settings/Diagnostics.tsx` (engine state with attempt, log tail viewer, "Open logs" via the opener plugin, "Copy diagnostics" = JSON of versions/ports/sizes/states/tail), `host/src/settings/Vaults.tsx` additions (buttons wired to Tauri commands `backup_create`, `backup_list`, `backup_restore`, `data_delete_all`; export via the control route with a native save dialog), `host/src/settings/About.tsx` update notice: `GET https://api.github.com/repos/<org>/desktop-knowledge-vault/releases/latest` once per launch (24 h cache, no telemetry), compare semver, show "A newer version is available: x.y.z — Download". Tests: semver compare; diagnostics redaction (no `token`, `key`, `secret` substrings).

### Task 5 — shell: tray, close-to-tray, single instance, window state, stale lock
Tray with "Open Knowledge Vault", "Engine: Ready/…", "Quit"; `closeToTray` from config: closing the window hides it and keeps the engine; "Quit" stops the engine; `tauri-plugin-single-instance` focuses the existing window; `tauri-plugin-window-state` persists size/position; `engine.lock` with the pid written on spawn and removed on stop. Tests: lock file semantics; config default `closeToTray: true`.

### Task 6 — e2e and manual checklist
Automated: kill the sidecar process during a session → banner "Reconnecting…" → vault usable again within 30 s; `data_delete_all` with the typed word removes everything but `backups/`. Manual (`e2e/MANUAL.md`): upgrade from the previous build with a 2k-note store (auto-backup appears, store opens); second launch focuses the window; tray quit stops the engine.

## Done when
The engine restarts itself after a crash and explains when it can't; upgrades back up first and never downgrade a store; users can back up, restore, export and delete; the tray keeps the engine available to tools; the update notice works; all gates green.

## Review follow-ups (from the Phase 0 review)

- `stop_sidecar` still blocks the main thread for up to 15 s (`std::thread::sleep` in the `CloseRequested` handler);
  move the stop off-thread with a "Stopping the engine…" state. Model `SidecarState` transitions
  (`starting → ready → exited`, plus `stopping`) as a pure function and unit-test it; `sidecar_info` already reports
  `exited` with the code.
- Port fallback inside the sidecar: the engine runs `strictPort: true` and `control.listen(cfg.controlPort)` has no
  upward fallback, so only the shell-spawn path survives a busy 4201/4202; the readiness line already carries the
  real ports, so the sidecar can fall back itself and the dev loop/e2e stop hard-failing.
- The piece registry logs `@powerhousedao/piece-reactor is shipped twice` (the sidecar's copy of
  `@powerhousedao/workflow` and bun's root cache, same version — it keeps one). Harmless today; a version drift
  between the two would not be. The stack-version check should cover duplicated stack packages in the install tree.
- `SidecarState::default()` reads as `exited` with no code. Unobservable today (Tauri runs setup before any IPC), but
  the restart gap between `Terminated` and the next spawn will surface it — model `never_started` / `restarting`
  explicitly when the supervisor arrives.
