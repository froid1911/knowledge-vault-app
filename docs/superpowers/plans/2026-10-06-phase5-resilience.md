# Desktop Knowledge Vault — Phase 5 "Resilience" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app survives what desktops do to it — engine crashes, upgrades, a second launch, stale locks, long absences — and the user can back up, restore, export and delete their data, see what the engine is doing, and keep it running in the tray.

**Architecture:** The engine's supervisor (the Tauri shell in production, `scripts/dev.mjs` in development) restarts a crashed engine with backoff and publishes every state as `sidecar:status`, keeping the last lines of its output; the sidecar guards its store by the stack version recorded in `config.json`, refuses a newer store, and backs the store up before a stack bump. Anything that needs a quiesced engine — back up, restore, delete all — is written as a **pending action** and performed by the sidecar at its next start, reached through the restart protocol Plan 1 built (a restart line, a respawn by whoever spawned it); so the same code path serves the shell, the dev loop and the e2e. Backups are directory copies (spec §9), exports are folders in the drive-sync format; the tray keeps the engine serving the CLI and agents while the window is closed; a single-instance plugin and an engine lock prevent two engines on one store.

**Tech Stack:** Rust (Tauri 2.12; `tauri` feature `tray-icon`; `tauri-plugin-single-instance = "2"`, `tauri-plugin-window-state = "2"`, the existing `tauri-plugin-opener`), Node 24+ (`fs.cpSync`, `fs.statfsSync`), vitest, Playwright. No zip crate: backups and exports are directories.

**Spec:** `docs/superpowers/specs/2026-10-06-desktop-knowledge-vault-design.md` — §9 (error handling and resilience, all), §5.2 (Vaults: back up/restore/export/delete; Diagnostics: open logs, copy diagnostics; About: update notice), §5.8 (window, tray), §4.6 (`POST /shutdown`), §3.3 (app-data layout). **Prerequisites:** Plans 0–4 landed (they are).

## Global Constraints

- Plans 0–4 constraints apply (loopback only; nothing leaves the machine; the engine's environment is the matrix plus an allowlist; the vault package is a dependency, never patched here).
- A backup is `backups/<YYYY-MM-DDTHH-mm-ssZ>-<stackVersion>/` holding copies of `reactor/`, `read-model/`, `attachments/`, `config.json`, `pipelines.json` and a `manifest.json` — **never** `secrets/` — made only while the engine is stopped (a pending action at start), after a free-space check (available ≥ 2 × the store's size; otherwise refused naming both numbers).
- A store written by a newer stack than the app's is **never** opened; the message names both versions: "This store was last opened by a newer Knowledge Vault (stack <recorded>) than this one (stack <app>). Download the newer version to open it."
- "Delete all local data" needs the typed word `delete`, happens at the next start, removes everything under the data dir except `backups/` unless "including backups" was ticked. Secrets go too — the app returns to first run.
- Diagnostics output never includes secrets, tokens or document content — only versions, ports, sizes, states and the last 200 log lines; the copy routine redacts anything matching `/(token|secret|key|authorization|bearer)[^\n]*/i` from the tail before copying.
- Backoff: restart delays 1 s, 4 s, 16 s; a fourth crash within 120 s gives up. Same numbers in Rust and in the dev loop.
- Copy: "Reconnecting…", "Restarting the engine…", "The engine keeps stopping", "Open logs", "Copy diagnostics", "Back up now", "Restore", "Export as documents", "Delete all local data", "A newer version is available: <version> — Download", "Update checks are off until the app has a release feed."
- Logs: the supervisor writes the engine's stdout/stderr to `<dataDir>/logs/sidecar.log`, rotating at 10 MiB × 5 files.

## Review Focus

1. **Crash loop** — three restarts within two minutes, then the fourth crash stops the supervisor with "The engine keeps stopping" and the log tail; a crash *after* a quiet two minutes starts the count again. Pinned by `src-tauri/src/backoff.rs` tests and `scripts/lib/backoff.test.mjs` (Task 1, Task 2).
2. **Disk nearly full when backing up** — the backup is refused before anything is copied, naming the space needed and available; a partially written backup directory from an interrupted copy is removed at the next start. Pinned by `sidecar/src/backups.test.ts` "refuses without room" and "cleans a partial backup" (Task 3).
3. **Upgrade with a running pipeline** — the auto-backup happens before the new stack opens the store, labelled with the stack that wrote it; a run in flight at shutdown is the runtime's to record. Pinned by `sidecar/src/main.process.test.ts` "an older store is backed up before it opens" (Task 3, Step 13); the UI sentence belongs to Plan 6's upgrade test.
4. **Second instance launched** (double-click twice) — the first window is focused and no second engine starts; a dev loop and the app on the same store refuse each other through `engine.lock`. Pinned by `sidecar/src/engine-lock.test.ts` (Task 3) and the single-instance wiring (Task 6, manual check in `e2e/MANUAL.md`).
5. **Clock skew / future-dated backups** — restore lists backups by name, never by file mtime; a backup from a newer stack is refused with the newer-store message. Pinned by `sidecar/src/backups.test.ts` "lists by name" and "refuses a newer backup" (Task 3).

---

## File structure

**Shell (`src-tauri/src/`)** — `backoff.rs` (new: delays and the crash window, pure), `log_tail.rs` (new: ring buffer + rotating file writer), `sidecar.rs` (modify: supervisor states, fatal line, respawn with backoff, off-thread stop), `lib.rs` (modify: tray, plugins, commands `open_logs`, `reveal_path`, `close_to_tray` handling), `config.rs` (modify: `UiConfig::load` for `ui.closeToTray`).
**Dev loop (`scripts/`)** — `lib/backoff.mjs` (new, mirrors `backoff.rs`), `lib/ready-line.mjs` (modify: `parseFatalLine`, `parseShutdownLine`), `dev.mjs` (modify: crash respawn with backoff, log tee, fatal reporting).
**Sidecar (`sidecar/src/`)** — `version.ts` (new: `compareVersions`), `store-guard.ts` (new), `backups.ts` (new), `pending.ts` (new), `engine-lock.ts` (new), `export.ts` (new), `settings.ts` (modify: `readStackVersion`/`writeStackVersion`, `ui.closeToTray` default), `control.ts` (modify: routes `/backups`, `/data/*`, `/shutdown`, `/logs/tail`, `/vaults/:id/export`, debug routes), `ready.ts` (modify: `fatalLine`, `shutdownLine`), `main.ts` (modify: lock, pending action, guard, record stack version, port fallback for the control server).
**Host (`host/src/`)** — `sidecar.ts` (modify: richer `SidecarStatus`), `state/use-engine-health.ts` (new), `components/EngineBanner.tsx` (new), `landing/StatusStrip.tsx` (modify: new states), `settings/Diagnostics.tsx` (modify: tail, open logs, copy diagnostics), `settings/Vaults.tsx` (modify: back up / restore / export / delete all), `settings/About.tsx` (modify: update notice), `update-check.ts` (new: semver + feed), `vaults.ts` (modify: API calls), `shell/tauri.ts` (new: `invokeIfTauri`).
**Tests** — beside each file as `*.test.ts(x)` / Rust `#[cfg(test)]`; `e2e/resilience.spec.ts`; `e2e/MANUAL.md`.

---

### Task 1 — Shell: supervisor with backoff, log tail and file, off-thread stop

**Files:**
- Create: `src-tauri/src/backoff.rs`, `src-tauri/src/log_tail.rs`
- Modify: `src-tauri/src/sidecar.rs`, `src-tauri/src/lib.rs` (`mod backoff; mod log_tail;`)
- Test: Rust `#[cfg(test)]` in both new files and in `sidecar.rs`

**Interfaces:**
- Produces: `backoff::restart_delay_ms(attempt: u32) -> Option<u64>` (1 → 1000, 2 → 4000, 3 → 16000, ≥ 4 → None); `backoff::CrashWindow::new(window_ms: u64)`, `.record(now_ms: u64) -> u32` (the attempt number: crashes within the window, including this one), `.reset()`; `log_tail::LogTail::new(capacity)`, `.push(&str)`, `.lines() -> Vec<String>`; `log_tail::RotatingLog::open(path, max_bytes, keep) -> io::Result<RotatingLog>`, `.write_line(&str)`; `sidecar::SidecarStatus { state: &'static str /* starting | ready | restarting | exited | gave_up | stopping */, ready, code, attempt: u32, delay_ms: Option<u64>, fatal: Option<FatalInfo { reason, message }>, log_tail: Vec<String> }` (serde camelCase); `sidecar::parse_fatal_line(&str) -> Option<FatalInfo>` for `{"event":"fatal","reason":"…","message":"…"}`; `sidecar::parse_shutdown_line(&str) -> bool` for `{"event":"shutdown"}`; `sidecar::exit_action(restart_requested, stopping, shutdown_requested, attempt) -> ExitAction { Respawn { delay_ms }, Restart /* immediate, the protection switch */, GaveUp, Exited }`.
- Consumes: Plan 1's restart line protocol (`parse_restart_line`), `SpawnParams`.

- [ ] **Step 1: Failing tests — backoff**

```rust
// src-tauri/src/backoff.rs (tests first; the module body comes in Step 3)
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn delays_are_one_four_sixteen_then_none() {
        assert_eq!(restart_delay_ms(1), Some(1_000));
        assert_eq!(restart_delay_ms(2), Some(4_000));
        assert_eq!(restart_delay_ms(3), Some(16_000));
        assert_eq!(restart_delay_ms(4), None);
        assert_eq!(restart_delay_ms(0), Some(1_000)); // a first crash counts as attempt 1
    }
    #[test]
    fn crashes_count_within_the_window_and_a_quiet_spell_starts_over() {
        let mut w = CrashWindow::new(120_000);
        assert_eq!(w.record(0), 1);
        assert_eq!(w.record(10_000), 2);
        assert_eq!(w.record(50_000), 3);
        assert_eq!(w.record(100_000), 4); // the fourth within two minutes: the caller gives up
        assert_eq!(w.record(300_000), 1); // everything earlier fell out of the window
        w.reset();
        assert_eq!(w.record(300_001), 1);
    }
}
```

- [ ] **Step 2: Run** `cd src-tauri && cargo test backoff` → FAIL to compile (`restart_delay_ms` not found).

- [ ] **Step 3: Implement**

```rust
// src-tauri/src/backoff.rs
//! Spec §9: a crashed engine is restarted after 1 s, 4 s, 16 s; a fourth crash
//! within two minutes means something is wrong that a restart will not fix.

const DELAYS_MS: [u64; 3] = [1_000, 4_000, 16_000];

/// The delay before restart attempt `attempt` (1-based); `None` means give up.
pub fn restart_delay_ms(attempt: u32) -> Option<u64> {
    let index = attempt.saturating_sub(1) as usize;
    DELAYS_MS.get(index).copied()
}

/// Crash timestamps within a sliding window; `record` returns how many fall in it, this one included.
pub struct CrashWindow {
    window_ms: u64,
    crashes: Vec<u64>,
}

impl CrashWindow {
    pub fn new(window_ms: u64) -> Self {
        Self { window_ms, crashes: Vec::new() }
    }
    pub fn record(&mut self, now_ms: u64) -> u32 {
        self.crashes.retain(|t| now_ms.saturating_sub(*t) < self.window_ms);
        self.crashes.push(now_ms);
        self.crashes.len() as u32
    }
    pub fn reset(&mut self) {
        self.crashes.clear();
    }
}
```

- [ ] **Step 4: Run** `cargo test backoff` → PASS (2 tests).

- [ ] **Step 5: Failing tests — log tail and rotating file**

```rust
// src-tauri/src/log_tail.rs (tests)
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keeps_only_the_last_lines() {
        let mut t = LogTail::new(3);
        for l in ["a", "b", "c", "d"] { t.push(l); }
        assert_eq!(t.lines(), vec!["b", "c", "d"]);
    }
    #[test]
    fn rotates_at_the_size_limit_and_keeps_the_newest_files() {
        let dir = std::env::temp_dir().join(format!("kv-log-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sidecar.log");
        let mut log = RotatingLog::open(&path, 64, 2).unwrap();
        for i in 0..20 { log.write_line(&format!("line {i} xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")); }
        assert!(path.exists());
        assert!(dir.join("sidecar.log.1").exists());
        assert!(!dir.join("sidecar.log.3").exists()); // keep = 2 → .1 and .2 at most
        assert!(std::fs::metadata(&path).unwrap().len() <= 64 + 40);
    }
}
```

- [ ] **Step 6: Run** `cargo test log_tail` → FAIL to compile.

- [ ] **Step 7: Implement**

```rust
// src-tauri/src/log_tail.rs
use std::collections::VecDeque;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

/// The last `capacity` lines of the engine's output — what Diagnostics and a "gave up" status show.
pub struct LogTail {
    capacity: usize,
    lines: VecDeque<String>,
}
impl LogTail {
    pub fn new(capacity: usize) -> Self {
        Self { capacity, lines: VecDeque::with_capacity(capacity) }
    }
    pub fn push(&mut self, line: &str) {
        if self.lines.len() == self.capacity { self.lines.pop_front(); }
        self.lines.push_back(line.trim_end().to_string());
    }
    pub fn lines(&self) -> Vec<String> {
        self.lines.iter().cloned().collect()
    }
}

/// `<path>` is the live file; when it passes `max_bytes` it becomes `<path>.1`, `.1` becomes `.2`, … up to `keep`.
pub struct RotatingLog {
    path: PathBuf,
    max_bytes: u64,
    keep: u32,
    file: File,
    written: u64,
}
impl RotatingLog {
    pub fn open(path: &Path, max_bytes: u64, keep: u32) -> std::io::Result<Self> {
        if let Some(parent) = path.parent() { std::fs::create_dir_all(parent)?; }
        let file = OpenOptions::new().create(true).append(true).open(path)?;
        let written = file.metadata().map(|m| m.len()).unwrap_or(0);
        Ok(Self { path: path.to_path_buf(), max_bytes, keep, file, written })
    }
    pub fn write_line(&mut self, line: &str) {
        if self.written >= self.max_bytes { let _ = self.rotate(); }
        if writeln!(self.file, "{line}").is_ok() { self.written += line.len() as u64 + 1; }
    }
    fn rotate(&mut self) -> std::io::Result<()> {
        let _ = std::fs::remove_file(self.numbered(self.keep));
        for n in (1..self.keep).rev() {
            let from = self.numbered(n);
            if from.exists() { std::fs::rename(&from, self.numbered(n + 1))?; }
        }
        std::fs::rename(&self.path, self.numbered(1))?;
        self.file = OpenOptions::new().create(true).append(true).open(&self.path)?;
        self.written = 0;
        Ok(())
    }
    fn numbered(&self, n: u32) -> PathBuf {
        PathBuf::from(format!("{}.{n}", self.path.display()))
    }
}
```

- [ ] **Step 8: Run** `cargo test log_tail` → PASS (2 tests).

- [ ] **Step 9: Failing tests — the supervisor's decisions and the new lines** (in `sidecar.rs` tests, replacing `a_restart_line_means_respawn_and_anything_else_means_exited`)

```rust
    #[test]
    fn exit_actions_cover_switch_restart_crash_backoff_give_up_stop_and_shutdown() {
        // the protection switch: an immediate restart, never counted as a crash
        assert_eq!(exit_action(true, false, false, 0), ExitAction::Restart);
        // the shell is stopping: always an exit
        assert_eq!(exit_action(true, true, false, 0), ExitAction::Exited);
        assert_eq!(exit_action(false, true, false, 2), ExitAction::Exited);
        // a shutdown the engine announced (POST /shutdown): an exit, not a crash
        assert_eq!(exit_action(false, false, true, 0), ExitAction::Exited);
        // crashes: backoff by attempt, then give up
        assert_eq!(exit_action(false, false, false, 1), ExitAction::Respawn { delay_ms: 1_000 });
        assert_eq!(exit_action(false, false, false, 3), ExitAction::Respawn { delay_ms: 16_000 });
        assert_eq!(exit_action(false, false, false, 4), ExitAction::GaveUp);
    }
    #[test]
    fn parses_fatal_and_shutdown_lines() {
        let f = parse_fatal_line(r#"{"event":"fatal","reason":"store-too-new","message":"This store was last opened by a newer Knowledge Vault"}"#).unwrap();
        assert_eq!(f.reason, "store-too-new");
        assert!(f.message.starts_with("This store"));
        assert!(parse_fatal_line(r#"{"event":"ready","port":1,"controlPort":2}"#).is_none());
        assert!(parse_shutdown_line(r#"{"event":"shutdown"}"#));
        assert!(!parse_shutdown_line("[sidecar] shutdown complete"));
    }
    #[test]
    fn status_states() {
        let s = status_of(None, true, None, 2, Some(4_000), None, false);
        assert_eq!(s.state, "restarting");
        assert_eq!(s.attempt, 2);
        let s = status_of(None, false, Some(1), 4, None, None, false);
        assert_eq!(s.state, "gave_up");
        let s = status_of(None, false, None, 0, None, None, true);
        assert_eq!(s.state, "stopping");
    }
```

- [ ] **Step 10: Run** `cargo test sidecar` → FAIL to compile.

- [ ] **Step 11: Implement the supervisor in `sidecar.rs`**

Changes, in order:
1. `SidecarState` gains `pub attempt: u32`, `pub delay_ms: Option<u64>`, `pub shutdown_requested: bool`, `pub fatal: Option<FatalInfo>`, `pub crashes: CrashWindow` (constructed with `120_000` — `Default` for `SidecarState` must be implemented by hand now), `pub tail: LogTail` (capacity 50), `pub log: Option<RotatingLog>`.
2. ```rust
   #[derive(Clone, Serialize, Debug, PartialEq, Eq)]
   #[serde(rename_all = "camelCase")]
   pub struct FatalInfo { pub reason: String, pub message: String }
   pub fn parse_fatal_line(line: &str) -> Option<FatalInfo> { /* like parse_ready_line; event == "fatal"; reason/message strings */ }
   pub fn parse_shutdown_line(line: &str) -> bool { /* event == "shutdown" */ }
   #[derive(Clone, Copy, Debug, PartialEq, Eq)]
   pub enum ExitAction { Restart, Respawn { delay_ms: u64 }, GaveUp, Exited }
   pub fn exit_action(restart_requested: bool, stopping: bool, shutdown_requested: bool, attempt: u32) -> ExitAction {
       if stopping || shutdown_requested { return ExitAction::Exited; }
       if restart_requested { return ExitAction::Restart; }
       match crate::backoff::restart_delay_ms(attempt) { Some(delay_ms) => ExitAction::Respawn { delay_ms }, None => ExitAction::GaveUp }
   }
   ```
3. `SidecarStatus` gains `attempt`, `delay_ms`, `fatal`, `log_tail`; `status_of(ready, running, code, attempt, delay_ms, fatal, stopping)`: `stopping` → "stopping"; ready → "ready"; running → if `attempt > 0 && code.is_none() && delay_ms.is_some()` → "restarting" else "starting"; not running → if `attempt >= 4` → "gave_up" else "exited". (`snapshot` passes the state's fields; `delay_ms` is set while waiting to respawn and cleared on spawn.)
4. In the reader task: every stdout/stderr line → `st.tail.push(line)` and `st.log.as_mut().map(|l| l.write_line(line))`; a fatal line → `st.fatal = Some(info)`; a shutdown line → `st.shutdown_requested = true`; a ready line clears `delay_ms` only — the crash count belongs to the two-minute window, never to a healthy start (an engine that comes up and then crashes every half-minute must still be reported; Review Focus 1).
5. `Terminated`: compute `attempt = if restart_requested || shutdown || stopping { st.attempt } else { st.crashes.record(now_ms()) }`; `match exit_action(...)`: `Restart` → spawn at once (as today); `Respawn { delay_ms }` → set `st.attempt = attempt; st.delay_ms = Some(delay_ms); st.running = true /* so the host shows restarting, not exited */`, emit, then `tauri::async_runtime::spawn(async move { tokio::time::sleep(Duration::from_millis(delay_ms)).await; if !stopping_now(&handle) { spawn_sidecar(...) } })`; `GaveUp` → `st.attempt = attempt; st.running = false;` emit (the host reads "gave_up" with `log_tail`); `Exited` → as today.
6. `spawn_sidecar` opens the log once per process: `if st.log.is_none() { st.log = RotatingLog::open(&paths.data_dir.join("logs/sidecar.log"), 10 * 1024 * 1024, 5).ok(); }` and writes a `--- start <ISO> attempt n` separator; it clears `delay_ms` and `fatal`.
7. `stop_sidecar` becomes non-blocking for the UI: it sets `stopping = true`, emits "stopping", writes `stop`, and waits in `tauri::async_runtime::spawn_blocking` (the 15 s grace, then kill), emitting the final state. `lib.rs`'s `CloseRequested` handler calls it; for `RunEvent::ExitRequested`/`Exit` the process is leaving, so keep the blocking wait there (`stop_sidecar_blocking`, the current body) — the engine must be stopped before the process ends.
8. `use_tokio`: `tauri` re-exports tokio through `tauri::async_runtime`; use `tauri::async_runtime::spawn` + `std::thread::sleep` inside `spawn_blocking` for the delay if `tokio::time` is not reachable without adding the `tokio` crate — either way no new dependency.

- [ ] **Step 12: Run** `cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test` → PASS (all, including the 3 new sidecar tests). By hand (Task 7 automates the dev-loop half): `bunx tauri dev` with no dev loop; `kill -9 <node pid of the engine>` → the window shows "Restarting the engine…", then the landing again; four kills within two minutes → "The engine keeps stopping" with the log tail.

- [ ] **Step 13: Commit** `git commit -m "feat(shell): supervise the engine — restart with backoff, give up on a crash loop, keep its output in a tail and a rotating log, stop off-thread"`

---

### Task 2 — Dev loop parity: crash respawn with backoff, fatal reporting, log tee

**Files:**
- Create: `scripts/lib/backoff.mjs`, `scripts/lib/backoff.test.mjs`
- Modify: `scripts/lib/ready-line.mjs` (+ `parseFatalLine`, `parseShutdownLine`), `scripts/lib/ready-line.test.mjs`, `scripts/dev.mjs`

**Interfaces:**
- Produces: `restartDelayMs(attempt) → number | null` (1000, 4000, 16000, null); `crashWindow(windowMs = 120_000)` → `{ record(nowMs) → attempt, reset() }`; `parseFatalLine(line) → { reason, message } | null`; `parseShutdownLine(line) → boolean`. The dev loop prints `[dev] the engine crashed (code N); restarting in 4 s (attempt 2)` / `[dev] the engine keeps stopping — see .dev-data/logs/sidecar.log` and tees every engine line into `<dataDir>/logs/sidecar.log` (append; rotation is the shell's job in production — the dev loop truncates the file at start).

- [ ] **Step 1: Failing tests**

```js
// scripts/lib/backoff.test.mjs
import { describe, expect, it } from "vitest";
import { crashWindow, restartDelayMs } from "./backoff.mjs";
describe("backoff (mirrors src-tauri/src/backoff.rs)", () => {
  it("delays 1 s, 4 s, 16 s, then gives up", () => {
    expect([1, 2, 3, 4].map(restartDelayMs)).toEqual([1000, 4000, 16000, null]);
  });
  it("counts crashes within two minutes and starts over after a quiet spell", () => {
    const w = crashWindow();
    expect([0, 10_000, 50_000, 100_000].map((t) => w.record(t))).toEqual([1, 2, 3, 4]);
    expect(w.record(300_000)).toBe(1);
  });
});
```
```js
// append to scripts/lib/ready-line.test.mjs
describe("fatal and shutdown lines", () => {
  it("parses them and nothing else", () => {
    expect(parseFatalLine('{"event":"fatal","reason":"store-too-new","message":"m"}')).toEqual({ reason: "store-too-new", message: "m" });
    expect(parseFatalLine('{"event":"ready","port":1,"controlPort":2}')).toBeNull();
    expect(parseShutdownLine('{"event":"shutdown"}')).toBe(true);
    expect(parseShutdownLine("[sidecar] shutting down")).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `bunx vitest run scripts/lib` → FAIL (module / export missing).

- [ ] **Step 3: Implement**

```js
// scripts/lib/backoff.mjs
const DELAYS_MS = [1000, 4000, 16000];
export function restartDelayMs(attempt) { return DELAYS_MS[Math.max(0, attempt - 1)] ?? null; }
export function crashWindow(windowMs = 120_000) {
  let crashes = [];
  return {
    record(nowMs) { crashes = crashes.filter((t) => nowMs - t < windowMs); crashes.push(nowMs); return crashes.length; },
    reset() { crashes = []; },
  };
}
```
```js
// scripts/lib/ready-line.mjs — add
function parseEvent(line) { const t = line.trim(); if (!t.startsWith("{")) return null; try { return JSON.parse(t); } catch { return null; } }
export function parseFatalLine(line) { const v = parseEvent(line); return v && v.event === "fatal" ? { reason: String(v.reason ?? ""), message: String(v.message ?? "") } : null; }
export function parseShutdownLine(line) { const v = parseEvent(line); return !!v && v.event === "shutdown"; }
```
`scripts/dev.mjs` — in `startSidecar()`: open `logs/sidecar.log` (`createWriteStream`, flags `"w"` at the first start, `"a"` afterwards) under `dataDir` and write every engine line to it; track `fatal` (printed and kept), `shutdownRequested`, `restartRequested`; `attempt` via `crashWindow()`; on `exit`: if `stopping` → return; if `restartRequested` → respawn now (Plan 1); if `shutdownRequested` → log "the engine shut down on request" and stop the loop (exit 0); else crash → `attempt = window.record(Date.now())`, `delay = restartDelayMs(attempt)` → if `delay === null` → log "keeps stopping" with the fatal (if any) and exit 1; else `setTimeout(startSidecar, delay)`. A ready line does not reset the window (Review Focus 1).

- [ ] **Step 4: Run** `bunx vitest run scripts/lib` → PASS; `node scripts/dev.mjs --no-shell --data-dir .dev-data` then `kill -9` the engine's pid (`pgrep -f "node dist/main.js"` — careful not to match your own shell) → `[dev] the engine crashed (code null); restarting in 1 s (attempt 1)` then `[dev] sidecar ready on 4201…`; `.dev-data/logs/sidecar.log` holds both runs.

- [ ] **Step 5: Commit** `git commit -m "feat(dev): the dev loop supervises like the shell — restart with backoff, give up on a crash loop, tee the engine's log"`

---

### Task 3 — Sidecar: store guard, pending actions, backups, engine lock, shutdown, control-port fallback

**Files:**
- Create: `sidecar/src/version.ts` (+ test), `sidecar/src/store-guard.ts` (+ test), `sidecar/src/backups.ts` (+ test), `sidecar/src/pending.ts` (+ test), `sidecar/src/engine-lock.ts` (+ test)
- Modify: `sidecar/src/settings.ts` (`readStackVersion`, `writeStackVersion`), `sidecar/src/ready.ts` (`fatalLine`, `shutdownLine`), `sidecar/src/control.ts`, `sidecar/src/control.test.ts`, `sidecar/src/main.ts`

**Interfaces:**
- Produces: `compareVersions(a, b) → -1 | 0 | 1` (semver `major.minor.patch[-pre.N]`; a release is newer than its prereleases; `dev.44 < dev.45`); `compareStack(app, recorded) → "fresh" | "same" | "upgrade" | "downgrade"`; `TOO_NEW_MESSAGE(recorded, app)`; `createBackup(dataDir, stackVersion, now?) → BackupInfo { name, path, bytes, stackVersion, createdAt }` (throws `NotEnoughSpaceError { needed, available }`); `listBackups(dataDir) → BackupInfo[]` (by name, newest first, from each `manifest.json`); `restoreBackup(dataDir, name, appStack, now?) → { preRestore: string }` (throws `BackupTooNewError`); `deleteAllData(dataDir, { includeBackups })`; `cleanPartialBackups(dataDir)`; `writePending(dataDir, action)`, `takePending(dataDir) → PendingAction | undefined`, `runPendingAction(dataDir, action, appStack, now?) → ActionResult { action, ok, detail, at }` (also written to `<dataDir>/last-action.json`); `acquireEngineLock(dataDir, pid) → () => void` (throws `StoreInUseError(pid)` when another live process holds it); `fatalLine(reason, message)`, `shutdownLine()`.
- Control routes: `GET /backups` → `{ backups, lastAction }`; `POST /backups` → 202 `{ restarting: true }`; `POST /backups/:name/restore` → 202; `POST /data/delete-all { confirm: "delete", includeBackups?: boolean }` → 202, 400 unless `confirm === "delete"`; `POST /shutdown` → 202 `{ stopping: true }`; `GET /logs/tail` → `{ lines: string[] }` (last 200 of `logs/sidecar.log`); `POST /debug/crash` → `process.exit(3)` only when `KV_DEBUG_ROUTES=1` (404 otherwise).
- Exit code 78 with a fatal line for `store-too-new` and `store-in-use`.
- Consumes: Plan 1's restart line; `readLocalProtection` (so delete-all can reset it — deleting `config.json` does).

- [ ] **Step 1: Failing tests — versions and the guard**

```ts
// sidecar/src/version.test.ts
import { describe, expect, it } from "vitest";
import { compareVersions } from "./version.js";
describe("compareVersions", () => {
  it("orders releases, prereleases and dev builds the semver way", () => {
    expect(compareVersions("6.2.3", "6.2.3")).toBe(0);
    expect(compareVersions("6.2.3", "6.2.3-dev.44")).toBe(1); // a release is newer than its prereleases
    expect(compareVersions("6.2.3-dev.44", "6.2.3-dev.45")).toBe(-1);
    expect(compareVersions("6.2.3-dev.9", "6.2.3-dev.44")).toBe(-1); // numeric, not lexical
    expect(compareVersions("6.10.0", "6.9.9")).toBe(1);
    expect(compareVersions("7.0.0-dev.1", "6.2.3")).toBe(1);
  });
});
```
```ts
// sidecar/src/store-guard.test.ts
import { describe, expect, it } from "vitest";
import { compareStack, TOO_NEW_MESSAGE } from "./store-guard.js";
describe("compareStack", () => {
  it("names the four situations", () => {
    expect(compareStack("6.2.3-dev.44", undefined)).toBe("fresh");
    expect(compareStack("6.2.3-dev.44", "6.2.3-dev.44")).toBe("same");
    expect(compareStack("6.2.3-dev.45", "6.2.3-dev.44")).toBe("upgrade");
    expect(compareStack("6.2.3-dev.44", "6.2.3-dev.45")).toBe("downgrade");
  });
  it("tells the user both versions and what to do", () => {
    expect(TOO_NEW_MESSAGE("6.2.3-dev.45", "6.2.3-dev.44")).toBe("This store was last opened by a newer Knowledge Vault (stack 6.2.3-dev.45) than this one (stack 6.2.3-dev.44). Download the newer version to open it.");
  });
});
```

- [ ] **Step 2: Run** `bunx vitest run sidecar/src/version.test.ts sidecar/src/store-guard.test.ts` → FAIL (modules missing).

- [ ] **Step 3: Implement**

```ts
// sidecar/src/version.ts
/** Semver with a numeric prerelease tail (`6.2.3-dev.44`): a release outranks its prereleases; identifiers compare numerically when both are numbers. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const [ca, pa] = split(a);
  const [cb, pb] = split(b);
  for (let i = 0; i < 3; i++) {
    if ((ca[i] ?? 0) !== (cb[i] ?? 0)) return (ca[i] ?? 0) < (cb[i] ?? 0) ? -1 : 1;
  }
  if (pa.length === 0 && pb.length === 0) return 0;
  if (pa.length === 0) return 1;
  if (pb.length === 0) return -1;
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i]; const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = Number(x); const ny = Number(y);
    const c = Number.isInteger(nx) && Number.isInteger(ny) ? Math.sign(nx - ny) : x < y ? -1 : x > y ? 1 : 0;
    if (c !== 0) return c as -1 | 1;
  }
  return 0;
}
function split(v: string): [number[], string[]] {
  const [core = "", pre = ""] = v.trim().split("-", 2);
  return [core.split(".").map((p) => Number.parseInt(p, 10) || 0), pre ? pre.split(".") : []];
}
```
```ts
// sidecar/src/store-guard.ts
import { compareVersions } from "./version.js";
export type StackRelation = "fresh" | "same" | "upgrade" | "downgrade";
/** Spec §9: never open a store written by a newer stack; back up before opening one written by an older stack. */
export function compareStack(appStack: string, recorded: string | undefined): StackRelation {
  if (!recorded) return "fresh";
  const c = compareVersions(appStack, recorded);
  return c === 0 ? "same" : c > 0 ? "upgrade" : "downgrade";
}
export const TOO_NEW_MESSAGE = (recorded: string, app: string) => `This store was last opened by a newer Knowledge Vault (stack ${recorded}) than this one (stack ${app}). Download the newer version to open it.`;
```
`settings.ts` — add `readStackVersion(dataDir): string | undefined` (top-level `stackVersion` of config.json) and `writeStackVersion(dataDir, v)` (preserves the other keys).

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Failing tests — backups** (real temp directories; `statfs` injected so "no room" is testable)

```ts
// sidecar/src/backups.test.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BackupTooNewError, cleanPartialBackups, createBackup, deleteAllData, listBackups, NotEnoughSpaceError, restoreBackup } from "./backups.js";

function store(): string {
  const d = mkdtempSync(join(tmpdir(), "kv-backups-"));
  for (const sub of ["reactor", "read-model", "attachments", "secrets", "logs"]) mkdirSync(join(d, sub));
  writeFileSync(join(d, "reactor", "base"), "x".repeat(1000));
  writeFileSync(join(d, "read-model", "base"), "y".repeat(500));
  writeFileSync(join(d, "secrets", "llm.key"), "sk-secret");
  writeFileSync(join(d, "config.json"), JSON.stringify({ version: 1, stackVersion: "6.2.3-dev.44" }));
  writeFileSync(join(d, "pipelines.json"), "{}");
  return d;
}
const plenty = () => ({ available: 10 ** 12 });
const NOW = () => "2026-10-07T12:00:00.000Z";

describe("backups", () => {
  it("copies the store — never the secrets — into a named folder with a manifest", () => {
    const d = store();
    const b = createBackup(d, "6.2.3-dev.44", { now: NOW, statfs: plenty });
    expect(b.name).toBe("2026-10-07T12-00-00Z-6.2.3-dev.44");
    expect(existsSync(join(b.path, "reactor", "base"))).toBe(true);
    expect(existsSync(join(b.path, "read-model", "base"))).toBe(true);
    expect(existsSync(join(b.path, "config.json"))).toBe(true);
    expect(existsSync(join(b.path, "secrets"))).toBe(false);
    expect(JSON.parse(readFileSync(join(b.path, "manifest.json"), "utf8"))).toMatchObject({ stackVersion: "6.2.3-dev.44", createdAt: NOW(), complete: true });
    expect(b.bytes).toBeGreaterThan(1500);
  });
  it("refuses without room, before copying anything (Review Focus 2)", () => {
    const d = store();
    expect(() => createBackup(d, "6.2.3-dev.44", { now: NOW, statfs: () => ({ available: 100 }) })).toThrow(NotEnoughSpaceError);
    expect(existsSync(join(d, "backups"))).toBe(false);
  });
  it("lists by name (Review Focus 5) and cleans a partial backup", () => {
    const d = store();
    createBackup(d, "6.2.3-dev.44", { now: () => "2026-10-07T12:00:00.000Z", statfs: plenty });
    createBackup(d, "6.2.3-dev.44", { now: () => "2026-10-08T09:00:00.000Z", statfs: plenty });
    mkdirSync(join(d, "backups", "2026-10-09T00-00-00Z-6.2.3-dev.44")); // interrupted: no manifest
    expect(cleanPartialBackups(d)).toEqual(["2026-10-09T00-00-00Z-6.2.3-dev.44"]);
    expect(listBackups(d).map((b) => b.name)).toEqual(["2026-10-08T09-00-00Z-6.2.3-dev.44", "2026-10-07T12-00-00Z-6.2.3-dev.44"]);
  });
  it("restores a backup, keeping what was there under pre-restore, and refuses one from a newer stack", () => {
    const d = store();
    const b = createBackup(d, "6.2.3-dev.44", { now: NOW, statfs: plenty });
    writeFileSync(join(d, "reactor", "base"), "changed");
    const r = restoreBackup(d, b.name, "6.2.3-dev.44", { now: () => "2026-10-07T13:00:00.000Z" });
    expect(readFileSync(join(d, "reactor", "base"), "utf8")).toBe("x".repeat(1000));
    expect(readFileSync(join(d, "backups", r.preRestore, "reactor", "base"), "utf8")).toBe("changed");
    const newer = createBackup(d, "6.2.3-dev.50", { now: () => "2026-10-07T14:00:00.000Z", statfs: plenty });
    expect(() => restoreBackup(d, newer.name, "6.2.3-dev.44", { now: NOW })).toThrow(BackupTooNewError);
  });
  it("delete-all keeps the backups unless told otherwise, and secrets never survive", () => {
    const d = store();
    createBackup(d, "6.2.3-dev.44", { now: NOW, statfs: plenty });
    deleteAllData(d, { includeBackups: false });
    expect(existsSync(join(d, "reactor"))).toBe(false);
    expect(existsSync(join(d, "secrets"))).toBe(false);
    expect(existsSync(join(d, "config.json"))).toBe(false);
    expect(listBackups(d)).toHaveLength(1);
    deleteAllData(d, { includeBackups: true });
    expect(existsSync(join(d, "backups"))).toBe(false);
  });
});
```

- [ ] **Step 6: Run** → FAIL (module missing).

- [ ] **Step 7: Implement `backups.ts`**

```ts
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compareVersions } from "./version.js";

/** Spec §9: what a backup holds — the store, its records, never the secrets. */
export const BACKUP_PARTS = ["reactor", "read-model", "attachments", "config.json", "pipelines.json"] as const;
export type BackupInfo = { name: string; path: string; bytes: number; stackVersion: string; createdAt: string };
export class NotEnoughSpaceError extends Error {
  constructor(public readonly needed: number, public readonly available: number) {
    super(`Not enough free space for a backup: ${human(needed)} needed, ${human(available)} available.`);
  }
}
export class BackupTooNewError extends Error {}
export class BackupNotFoundError extends Error {}
type Deps = { now?: () => string; statfs?: (dir: string) => { available: number } };

const backupsDir = (dataDir: string) => join(dataDir, "backups");
const stamp = (iso: string) => iso.replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
export function human(bytes: number): string { return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.ceil(bytes / 1e6)} MB`; }
function sizeOf(path: string): number {
  if (!existsSync(path)) return 0;
  const s = statSync(path);
  if (!s.isDirectory()) return s.size;
  return readdirSync(path).reduce((n, entry) => n + sizeOf(join(path, entry)), 0);
}
function freeSpace(dir: string): { available: number } {
  const s = statfsSync(dir);
  return { available: Number(s.bavail) * Number(s.bsize) };
}

export function createBackup(dataDir: string, stackVersion: string, deps: Deps = {}): BackupInfo {
  const now = deps.now ?? (() => new Date().toISOString());
  const storeBytes = BACKUP_PARTS.reduce((n, part) => n + sizeOf(join(dataDir, part)), 0);
  const { available } = (deps.statfs ?? freeSpace)(dataDir);
  if (available < storeBytes * 2) throw new NotEnoughSpaceError(storeBytes * 2, available);
  const createdAt = now();
  const name = `${stamp(createdAt)}-${stackVersion}`;
  const path = join(backupsDir(dataDir), name);
  mkdirSync(path, { recursive: true });
  for (const part of BACKUP_PARTS) {
    const from = join(dataDir, part);
    if (existsSync(from)) cpSync(from, join(path, part), { recursive: true });
  }
  const bytes = sizeOf(path);
  writeFileSync(join(path, "manifest.json"), JSON.stringify({ name, stackVersion, createdAt, bytes, complete: true }, null, 2) + "\n");
  return { name, path, bytes, stackVersion, createdAt };
}

/** A backup directory without a complete manifest is an interrupted copy: removed, and named. */
export function cleanPartialBackups(dataDir: string): string[] {
  if (!existsSync(backupsDir(dataDir))) return [];
  const removed: string[] = [];
  for (const name of readdirSync(backupsDir(dataDir))) {
    const manifest = join(backupsDir(dataDir), name, "manifest.json");
    if (!existsSync(manifest)) { rmSync(join(backupsDir(dataDir), name), { recursive: true, force: true }); removed.push(name); }
  }
  return removed;
}

/** By name — the stamp is in it — newest first; never by file time (Review Focus 5). */
export function listBackups(dataDir: string): BackupInfo[] {
  if (!existsSync(backupsDir(dataDir))) return [];
  const out: BackupInfo[] = [];
  for (const name of readdirSync(backupsDir(dataDir))) {
    try {
      const m = JSON.parse(readFileSync(join(backupsDir(dataDir), name, "manifest.json"), "utf8")) as Partial<BackupInfo> & { complete?: boolean };
      if (m.complete) out.push({ name, path: join(backupsDir(dataDir), name), bytes: m.bytes ?? 0, stackVersion: m.stackVersion ?? "", createdAt: m.createdAt ?? "" });
    } catch { /* not a backup */ }
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

export function restoreBackup(dataDir: string, name: string, appStack: string, deps: Pick<Deps, "now"> = {}): { preRestore: string } {
  const backup = listBackups(dataDir).find((b) => b.name === name);
  if (!backup) throw new BackupNotFoundError(`No backup named ${name}.`);
  if (compareVersions(backup.stackVersion, appStack) > 0) throw new BackupTooNewError(`This backup was made by a newer Knowledge Vault (stack ${backup.stackVersion}) than this one (stack ${appStack}). Download the newer version to restore it.`);
  const now = deps.now ?? (() => new Date().toISOString());
  const preRestore = `pre-restore-${stamp(now())}`;
  const keep = join(backupsDir(dataDir), preRestore);
  mkdirSync(keep, { recursive: true });
  for (const part of BACKUP_PARTS) {
    const current = join(dataDir, part);
    if (existsSync(current)) renameSync(current, join(keep, part));
    const from = join(backup.path, part);
    if (existsSync(from)) cpSync(from, current, { recursive: true });
  }
  writeFileSync(join(keep, "manifest.json"), JSON.stringify({ name: preRestore, stackVersion: appStack, createdAt: now(), bytes: sizeOf(keep), complete: true }, null, 2) + "\n");
  return { preRestore };
}

/** Everything under the data dir goes — the app returns to first run — except the backups unless asked. */
export function deleteAllData(dataDir: string, opts: { includeBackups: boolean }): void {
  for (const entry of readdirSync(dataDir)) {
    if (entry === "backups" && !opts.includeBackups) continue;
    rmSync(join(dataDir, entry), { recursive: true, force: true });
  }
}
```

- [ ] **Step 8: Run** → PASS (5 tests).

- [ ] **Step 9: Failing tests — pending actions and the engine lock**

```ts
// sidecar/src/pending.test.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runPendingAction, takePending, writePending } from "./pending.js";
import { listBackups } from "./backups.js";
const plenty = { statfs: () => ({ available: 10 ** 12 }), now: () => "2026-10-07T12:00:00.000Z" };
function store() { const d = mkdtempSync(join(tmpdir(), "kv-pending-")); for (const s of ["reactor", "read-model", "secrets"]) mkdirSync(join(d, s)); writeFileSync(join(d, "reactor", "base"), "x"); writeFileSync(join(d, "config.json"), "{}"); return d; }
describe("pending actions", () => {
  it("is taken once", () => {
    const d = store();
    writePending(d, { action: "backup" });
    expect(takePending(d)).toEqual({ action: "backup" });
    expect(takePending(d)).toBeUndefined();
  });
  it("runs a backup, a restore and a delete-all at the next start, recording the result for the host", () => {
    const d = store();
    const made = runPendingAction(d, { action: "backup" }, "6.2.3-dev.44", plenty);
    expect(made.ok).toBe(true);
    const [backup] = listBackups(d);
    expect(JSON.parse(readFileSync(join(d, "last-action.json"), "utf8"))).toMatchObject({ action: "backup", ok: true });
    writeFileSync(join(d, "reactor", "base"), "changed");
    expect(runPendingAction(d, { action: "restore", name: backup!.name }, "6.2.3-dev.44", plenty).ok).toBe(true);
    expect(readFileSync(join(d, "reactor", "base"), "utf8")).toBe("x");
    const gone = runPendingAction(d, { action: "delete-all", includeBackups: false }, "6.2.3-dev.44", plenty);
    expect(gone.ok).toBe(true);
    expect(existsSync(join(d, "reactor"))).toBe(false);
    expect(listBackups(d).length).toBeGreaterThan(0);
    expect(existsSync(join(d, "last-action.json"))).toBe(true); // written after the deletion, so the host can say what happened
  });
  it("reports a refused backup without throwing — the engine still starts", () => {
    const d = store();
    const r = runPendingAction(d, { action: "backup" }, "6.2.3-dev.44", { ...plenty, statfs: () => ({ available: 1 }) });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/Not enough free space/);
  });
});
```
```ts
// sidecar/src/engine-lock.test.ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireEngineLock, StoreInUseError } from "./engine-lock.js";
describe("engine lock", () => {
  it("takes the lock, refuses a live holder, replaces a dead one, and releases", () => {
    const d = mkdtempSync(join(tmpdir(), "kv-lock-"));
    const release = acquireEngineLock(d, process.pid, () => true);
    expect(() => acquireEngineLock(d, 424242, () => true)).toThrow(StoreInUseError); // another live process holds it
    release();
    writeFileSync(join(d, "engine.lock"), JSON.stringify({ pid: 999999, startedAt: "x" }));
    const again = acquireEngineLock(d, process.pid, () => false); // the recorded pid is dead
    again();
  });
});
```

- [ ] **Step 10: Run** → FAIL.

- [ ] **Step 11: Implement**

```ts
// sidecar/src/pending.ts
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createBackup, deleteAllData, restoreBackup } from "./backups.js";
export type PendingAction = { action: "backup" } | { action: "restore"; name: string } | { action: "delete-all"; includeBackups: boolean };
export type ActionResult = { action: PendingAction["action"]; ok: boolean; detail: string; at: string };
const file = (dataDir: string) => join(dataDir, "pending-action.json");
export function writePending(dataDir: string, action: PendingAction): void { writeFileSync(file(dataDir), JSON.stringify(action)); }
export function takePending(dataDir: string): PendingAction | undefined {
  if (!existsSync(file(dataDir))) return undefined;
  try { return JSON.parse(readFileSync(file(dataDir), "utf8")) as PendingAction; } catch { return undefined; } finally { rmSync(file(dataDir), { force: true }); }
}
/** Spec §9: back up / restore / delete all need a quiesced engine — they run here, before the store opens. Never throws: a refusal is a result the host shows. */
export function runPendingAction(dataDir: string, action: PendingAction, appStack: string, deps: { now?: () => string; statfs?: (d: string) => { available: number } } = {}): ActionResult {
  const now = deps.now ?? (() => new Date().toISOString());
  let result: ActionResult;
  try {
    if (action.action === "backup") { const b = createBackup(dataDir, appStack, deps); result = { action: "backup", ok: true, detail: `Backed up to ${b.name}`, at: now() }; }
    else if (action.action === "restore") { const r = restoreBackup(dataDir, action.name, appStack, deps); result = { action: "restore", ok: true, detail: `Restored ${action.name}; what was there is kept as ${r.preRestore}`, at: now() }; }
    else { deleteAllData(dataDir, { includeBackups: action.includeBackups }); result = { action: "delete-all", ok: true, detail: action.includeBackups ? "Everything was deleted." : "Everything but the backups was deleted.", at: now() }; }
  } catch (error) {
    result = { action: action.action, ok: false, detail: error instanceof Error ? error.message : String(error), at: now() };
  }
  writeFileSync(join(dataDir, "last-action.json"), JSON.stringify(result, null, 2) + "\n");
  return result;
}
export function readLastAction(dataDir: string): ActionResult | undefined {
  try { return JSON.parse(readFileSync(join(dataDir, "last-action.json"), "utf8")) as ActionResult; } catch { return undefined; }
}
```
```ts
// sidecar/src/engine-lock.ts
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export class StoreInUseError extends Error { constructor(public readonly pid: number) { super(`Another Knowledge Vault engine is using this store (process ${pid}). Close it first.`); } }
const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** One engine per store: the lock names the holder; a dead holder's lock is replaced. */
export function acquireEngineLock(dataDir: string, pid: number, alive: (pid: number) => boolean = isAlive): () => void {
  const path = join(dataDir, "engine.lock");
  if (existsSync(path)) {
    try { const held = JSON.parse(readFileSync(path, "utf8")) as { pid?: number }; if (held.pid && held.pid !== pid && alive(held.pid)) throw new StoreInUseError(held.pid); } catch (e) { if (e instanceof StoreInUseError) throw e; }
  }
  writeFileSync(path, JSON.stringify({ pid, startedAt: new Date().toISOString() }));
  return () => rmSync(path, { force: true });
}
```
`ready.ts` — add `fatalLine(reason, message)` → `{"event":"fatal",…}` and `shutdownLine()` → `{"event":"shutdown"}`.

`main.ts` — the order at start, before anything opens the store: (1) `prepareDataDir`; (2) `const release = acquireEngineLock(cfg.dataDir, process.pid)` — a `StoreInUseError` prints the fatal line and exits 78; (3) `const pending = takePending(cfg.dataDir); if (pending) runPendingAction(…, STACK_VERSION)` (log the result; after a `delete-all` continue — the store is now fresh); (4) `cleanPartialBackups`; (5) the guard: `const relation = compareStack(STACK_VERSION, readStackVersion(cfg.dataDir))`: `downgrade` → fatal `store-too-new` + exit 78; `upgrade` → `runPendingAction(dataDir, { action: "backup" }, recordedStack)` first — labelled with the stack that **wrote** the store, so the restore guard reads it right (a refused backup is logged and the start proceeds — the user chose to upgrade; the result is in `last-action.json` and Diagnostics shows it); (6) start the Switchboard as today; (7) after `waitForHealth`: `writeStackVersion(cfg.dataDir, STACK_VERSION)`; (8) `release()` on exit (`process.on("exit")`). `POST /shutdown` → print `shutdownLine()` then SIGINT. `GET /logs/tail` → last 200 lines of `logs/sidecar.log` (the file the supervisor writes; empty when it does not exist). The control server falls back upward on a busy port: `listen(port)` retries `port+1 … port+20` and the readiness line carries the real one (the dev loop and the e2e read it from the line already).

- [ ] **Step 12: Control tests** — extend `control.test.ts` with fake deps `backups: { list, requestBackup, requestRestore, requestDeleteAll, lastAction }`, `shutdown`, `logTail`, `debug: { crash }`: `GET /backups` shape; `POST /backups` → 202 and `requested` recorded; `POST /data/delete-all` → 400 without `confirm: "delete"`, 202 with; `POST /shutdown` → 202; `GET /logs/tail` → `{ lines }`; `POST /debug/crash` → 404 unless `debugRoutes: true` in deps. Run → FAIL, implement the routes (each `POST` that needs a quiesced engine writes the pending action through the dep and schedules the same restart as the protection switch), run → PASS.

- [ ] **Step 13: A real-process test for the guard and the lock** — `sidecar/src/main.process.test.ts` (vitest, 60 s timeout): build the sidecar (`bun run --cwd sidecar build` in `beforeAll`), spawn `node dist/main.js` with a temp `KV_DATA_DIR` whose `config.json` says `stackVersion: "99.0.0"` and free ports; expect exit code 78 and a stdout line parsed by `parseFatalLine` with `reason === "store-too-new"` and the message naming `99.0.0`. Second case: write `engine.lock` with the test's own pid → exit 78, `reason === "store-in-use"`. Third case ("an older store is backed up before it opens", Review Focus 3): `config.json` says `stackVersion: "6.2.3-dev.1"`; wait for the readiness line, then stop the engine (close its stdin) and assert `backups/` holds one entry whose `manifest.json` says `stackVersion: "6.2.3-dev.1"` and that `config.json` now records the running stack. Run → PASS.

- [ ] **Step 14: Run** `bun run test && bun run tsc` → PASS. By hand on the dev loop: `curl -X POST …/backups` → the engine restarts; `GET /backups` lists the backup; `.dev-data/last-action.json` says so.

- [ ] **Step 15: Commit** `git commit -m "feat(sidecar): guard the store by stack version, back up before an upgrade, pending actions at start (back up, restore, delete all), engine lock, POST /shutdown, log tail"`

---

### Task 4 — Sidecar: export a vault as documents

**Files:**
- Create: `sidecar/src/export.ts`, `sidecar/src/export.test.ts`
- Modify: `sidecar/src/control.ts` (+ `GET /vaults/:id/export`), `sidecar/src/main.ts`

**Interfaces:**
- Produces: `exportVault(opts: { origin; driveId; dataDir; fetchImpl?; now? }) → { path: string; documents: number; bytes: number }` — writes `<dataDir>/exports/<slug>-<stamp>/` with `tree.json` (the drive's nodes), `documents/<id>.json` (`{ id, documentType, name, state, operations }` for every file node of the drive, operations paged 500 at a time through `document(idOrSlug) { document { documentType name state operations(paging) { items { index error action { type input } } hasNextPage cursor } } }`) and `llms-full.txt` (the vault's REST `GET llms-full.txt?drive=<id>`, through the engine). The drive-sync format the vault repo's `scripts/drive-sync/upload.py` restores.
- Control: `GET /vaults/:id/export` → `{ export: { path, documents, bytes } }` (synchronous; a 2k-document vault takes a few seconds — the host shows a spinner).

- [ ] **Step 1: Failing test** — fake reactor: `document(idOrSlug: "drive1")` returns `state.global.nodes` with two file nodes and one folder; each document read returns state + 2 operations; `llms-full.txt` returns text. Assert the folder layout, `tree.json` has 3 nodes, `documents/` has 2 files each with `operations.length === 2`, `llms-full.txt` content, and `{ documents: 2 }`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (reuse `gql` from `reactor-gql.ts`; the REST read goes through `fetchImpl` to `${origin}/api/@powerhousedao/knowledge-note/llms-full.txt?drive=${driveId}` — the engine fetch carries the bearer when protected). **Step 4: Run** → PASS; by hand on the dev loop: `GET /vaults/<id>/export` → the folder exists under `.dev-data/exports/`.
- [ ] **Step 5: Commit** `git commit -m "feat(sidecar): export a vault as documents (drive-sync format) under exports/"`

---

### Task 5 — Host: engine health banner, richer status, Diagnostics, Vaults data actions, About update notice

**Files:**
- Create: `host/src/state/use-engine-health.ts` (+ test), `host/src/components/EngineBanner.tsx` (+ test), `host/src/update-check.ts` (+ test), `host/src/shell/tauri.ts`
- Modify: `host/src/sidecar.ts` (+ test), `host/src/landing/StatusStrip.tsx` (+ test in `Landing.test.tsx`), `host/src/settings/Diagnostics.tsx`, `host/src/settings/Vaults.tsx` (+ tests), `host/src/settings/About.tsx`, `host/src/vaults.ts` (+ test), `host/src/screens/Settings.tsx` (API), `host/src/App.tsx` (banner), `host/src/host.css`

**Interfaces:**
- `ShellStatus` gains `attempt: number`, `delayMs: number | null`, `fatal: { reason; message } | null`, `logTail: string[]`; host `SidecarStatus` gains `{ state: "restarting"; attempt; delayMs }`, `{ state: "gave_up"; code; logTail; fatal }`, and `exited` carries `fatal`.
- `useEngineHealth(info, pollMs = 5000)` → `"ok" | "degraded"` (two consecutive failed `/status` reads → degraded; one success → ok). `EngineBanner` renders "Reconnecting…" while degraded (role status), nothing otherwise; mounted in `App` above every screen.
- Control API (host `vaults.ts`): `fetchBackups(info) → { backups, lastAction }`, `requestBackup(info)`, `requestRestore(info, name)`, `requestDeleteAll(info, includeBackups)` (body `{ confirm: "delete", includeBackups }`), `exportVault(info, id)`, `fetchLogTail(info) → string[]`, `shutdownEngine(info)`.
- `invokeIfTauri<T>(command, args) → Promise<T | undefined>` (undefined in a browser) — used for `open_logs`, `reveal_path`.
- `compareSemver(a, b)`, `checkForUpdate(feedUrl, current, fetchImpl, storage, now) → { latest, url } | null` with a 24 h cache under `kv.update-check`; `UPDATE_FEED = ""` in `host/src/update-feed.ts` (set in Plan 6 when the repository exists) → About shows "Update checks are off until the app has a release feed." while empty.
- Copy in StatusStrip: `restarting` → "Restarting the engine…" + "Attempt n of 3; back in a moment."; `gave_up` → "The engine keeps stopping" + the fatal message or "Open Settings › Diagnostics for its last lines."; `exited` with `fatal` → the fatal message.
- **Remote vaults (spec §9, left over from Plan 3):** `sidecar/src/remote.ts` gains `RemoteTooOldError` — `checkRemoteVault` first asks `{ __type(name: "Query") { fields { name args { name } } } }` and refuses when `document` has no `idOrSlug` argument: "This vault's server is too old for this app (it needs Powerhouse 6.2.3-dev.35 or newer)." (control → 409). `host/src/state/use-remote-health.ts` probes the remote's `/graphql` with `{ __typename }` every 15 s while a remote vault is open; two failures → `RemoteWorkspaceScreen` shows "You're offline — this vault lives on <host> and needs a connection." (role status), cleared on the next success. Tests: `remote.test.ts` (too old; current server passes), `use-remote-health.test.ts`, `RemoteWorkspaceScreen.test.tsx` (banner appears and clears).

- [ ] **Step 1: Failing tests** — `use-engine-health.test.ts` (two failures → degraded; success → ok); `EngineBanner.test.tsx`; `remote.test.ts` "refuses a server older than dev.35" and `use-remote-health.test.ts` / `RemoteWorkspaceScreen.test.tsx` "offline banner"; `sidecar.test.ts` (`statusFromShell` for restarting/gave_up/fatal); `update-check.test.ts` (semver; cache honoured; empty feed → null); `Vaults.test.tsx` ("Back up now" → `requestBackup` then shows "Restarting the engine…"; "Restore" on a listed backup → confirmation → `requestRestore`; "Delete all local data" disabled until `delete` is typed; "Export as documents" → `exportVault` → shows the path); `Settings.test.tsx` Diagnostics: tail shown, "Copy diagnostics" produces JSON without the substrings `sk-`, `Bearer`, `token` (feed a tail line containing `Authorization: Bearer abc` and assert the copied text lacks it).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** per the interfaces (redaction: `line.replace(/(token|secret|key|authorization|bearer)[^\n]*/gi, "$1 […]")`). **Step 4: Run** `bun run test && bun run tsc` → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(host): reconnecting banner, engine states (restarting, keeps stopping, fatal), diagnostics with log tail and redacted copy, back up / restore / export / delete all, update notice"`

---

### Task 6 — Shell: tray, close-to-tray, single instance, window state, commands

**Files:**
- Modify: `src-tauri/Cargo.toml` (`tauri = { version = "2", features = ["tray-icon"] }`, `tauri-plugin-single-instance = "2"`, `tauri-plugin-window-state = "2"`), `src-tauri/src/lib.rs`, `src-tauri/src/config.rs` (`UiConfig::load(path) -> UiConfig { close_to_tray: bool /* default true */ }` from config.json's `ui` section), `src-tauri/capabilities/default.json` (`"window-state:default"`), `sidecar/src/settings.ts` (`ui.closeToTray` in `AppSettings`, PUT `/settings { ui: { closeToTray } }`), `host/src/settings/Appearance.tsx` ("Keep the engine running when the window closes" switch)

**Interfaces:**
- Tauri commands: `open_logs(state) -> Result<(), String>` (opener `open_path` on `<data_dir>/logs`), `reveal_path(path: String)`, `quit_app(app)` (stops the engine, then exits).
- Tray menu: "Open Knowledge Vault", a disabled "Engine: <state>" line refreshed from `sidecar:status`, "Quit". Closing the window with `closeToTray` true hides it (`window.hide()`), the engine keeps serving; "Open Knowledge Vault" shows it. `tauri-plugin-single-instance`: the callback focuses the existing window. `tauri-plugin-window-state` restores size/position.

- [ ] **Step 1: Failing tests** — `config.rs`: `UiConfig::load` defaults `close_to_tray = true` when the file or the section is missing, reads `false`; `sidecar/src/settings.test.ts`: `ui.closeToTray` round-trips. **Step 2: Run** → FAIL. **Step 3: Implement** (menu built with `tauri::menu::MenuBuilder`; `TrayIconBuilder::with_id("main")` using `app.default_window_icon()`; the `CloseRequested` handler: `if UiConfig::load(..).close_to_tray { api.prevent_close(); window.hide() } else { stop_sidecar }`). **Step 4: Run** `cargo clippy --all-targets -- -D warnings && cargo test && bun run test` → PASS; by hand: close the window → the tray icon stays, `curl …/status` still answers; tray → Quit → the engine stops; launch the app twice → one window, focused.
- [ ] **Step 5: Commit** `git commit -m "feat(shell): tray with close-to-tray, single instance, window state, open-logs and reveal commands"`

---

### Task 7 — e2e and the manual checklist

**Files:**
- Create: `e2e/resilience.spec.ts`, `e2e/MANUAL.md`
- Modify: `playwright.config.ts` (`webServer.command` gains `KV_DEBUG_ROUTES=1`)

- [ ] **Step 1: Write `e2e/resilience.spec.ts`** (runs last, alphabetically after `pipeline`): (a) **crash**: open a vault; `POST /debug/crash` through the control API; expect the banner "Reconnecting…" within 10 s; expect the vault's "Notes" visible again within 30 s (the dev loop respawned after 1 s); (b) **back up**: Settings › Vaults → "Back up now" → "Restarting the engine…" → within 60 s the backups list shows one entry named like `/^\d{4}-\d{2}-\d{2}T.*-6\.2\.3/`; (c) **delete all**: type `delete`, leave "including backups" unticked, confirm → within 60 s the landing shows the first-run form ("Create your first vault") and `GET /backups` still lists the backup. Set `test.setTimeout(240_000)`.
- [ ] **Step 2: Run** `bun run e2e` → the five specs pass.
- [ ] **Step 3: Write `e2e/MANUAL.md`** — the checks a person does with the built app: upgrade from the previous build with a 2k-note store (the auto-backup appears in Settings › Vaults, the store opens); a store from a newer build refuses with the message; launch twice → one window, focused; close → tray keeps the engine (`switchboard ping` still answers); tray → Quit stops it; kill the engine four times within two minutes → "The engine keeps stopping" with the tail.
- [ ] **Step 4: Commit** `git commit -m "test(e2e): crash recovery, back up, delete all; manual checklist for the built app"`

## Done when
The engine restarts itself after a crash and says so when it cannot; an upgrade backs the store up first and a newer store is never opened; users can back up, restore, export and delete from Settings, and see the engine's state and last lines in Diagnostics; the tray keeps the engine available to tools with the window closed; a second launch focuses the first; all gates green (unit, Rust, e2e); the update notice is wired and honestly off until Plan 6 names the feed.

## Review follow-ups (from earlier reviews, resolved in this plan)

- `stop_sidecar` blocking the main thread → Task 1 moves the stop off-thread with a "stopping" state.
- Control-port fallback → Task 3 (the control server falls back upward; the readiness line carries the port).
- `SidecarState::default()` reading as `exited` → Task 1's explicit states (`starting`, `restarting`, `gave_up`, `stopping`).
- The piece registry's "shipped twice" note stays a Plan 6 concern (stack-version check over duplicated packages).
