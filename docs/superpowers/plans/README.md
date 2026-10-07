# Implementation plans

| Plan | Phase | Depth |
|---|---|---|
| `2026-10-06-phase0-foundation.md` | 0 — foundation: package host mode, sidecar, host, dev loop, Tauri dev shell, e2e gate | full TDD steps |
| `2026-10-06-phase1-lite-launcher-settings-workflows.md` | 1-lite — launcher polish, vault rename/delete, Settings view, Workflow Studio full-view (pulled forward) | task outline, executed natively |
| `2026-10-06-phase1-vaults-identity.md` | 1 — sign-in, protection switch, identity in Settings (the landing and Settings shell exist since 1-lite) | done 2026-10-07 (Tasks 1, 2, 4, 5 landed through Plans 1-lite/4; Task 3 + 6 and the review's fixes here; ledger in `ledgers/`) |
| `2026-10-06-phase2-pipeline.md` | 2 — pipeline template, models, Workflow Studio | tasks landed 2026-10-07 (vault package d1b2fb59; desktop 3b33fa4..2e5c46f); fresh review pending |
| `2026-10-06-phase3-remote-vaults.md` | 3 — remote vaults in client mode, host-provided bearer | landed through Plan 1-lite (check → add → open as the user; 401/403/404 reasons; vault package 4bc48842); the offline banner and the too-old-server probe moved to Plan 5 Task 5 |
| `2026-10-06-phase4-conversion.md` | 4 — conversion without Docker: the docling service as the in-app helper; Stage A (no-binding mode, open-mode guard, runtime URL, helper, Settings) and Stage B (binding and models installable from Settings) landed | done; darwin binding in Plan 6 |
| `2026-10-06-phase5-resilience.md` | 5 — supervisor, backups, upgrades, tray, diagnostics, export, remote offline/too-old | full TDD steps (expanded 2026-10-07) |
| `2026-10-06-phase6-packaging-ci.md` | 6 — installers, CI, perf gates, icon | outline |

Outline plans fix interfaces, contracts, review-focus inputs and the tests that pin them; they are expanded into
write-test / run / implement / run / commit steps when the preceding phase has landed, because their details
depend on what that phase reveals. Execute in order; each plan assumes the previous ones are merged.

**Ledgers.** Each plan is executed with an SDD ledger (`.superpowers/sdd/<plan>/progress.md`: task evidence and every
ruling with its cost-if-wrong). The working copy is ignored by git; when a plan lands, the ledger is copied to
`docs/superpowers/ledgers/<plan>.md` and committed with the branch, so reviews and later plans can rely on it.
