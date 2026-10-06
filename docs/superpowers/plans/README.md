# Implementation plans

| Plan | Phase | Depth |
|---|---|---|
| `2026-10-06-phase0-foundation.md` | 0 — foundation: package host mode, sidecar, host, dev loop, Tauri dev shell, e2e gate | full TDD steps |
| `2026-10-06-phase1-lite-launcher-settings-workflows.md` | 1-lite — launcher polish, vault rename/delete, Settings view, Workflow Studio full-view (pulled forward) | task outline, executed natively |
| `2026-10-06-phase1-vaults-identity.md` | 1 — sign-in, protection switch, identity in Settings (the landing and Settings shell exist since 1-lite) | full TDD steps |
| `2026-10-06-phase2-pipeline.md` | 2 — pipeline template, models, Workflow Studio | full TDD steps |
| `2026-10-06-phase3-remote-vaults.md` | 3 — remote vaults in client mode, host-provided bearer | outline (expand before execution) |
| `2026-10-06-phase4-conversion.md` | 4 — conversion without Docker: the docling service as the in-app helper; Stage A (no-binding mode, open-mode guard, runtime URL, helper, Settings) and Stage B (binding and models installable from Settings) landed | done; darwin binding in Plan 6 |
| `2026-10-06-phase5-resilience.md` | 5 — supervisor, backups, upgrades, tray, diagnostics | outline |
| `2026-10-06-phase6-packaging-ci.md` | 6 — installers, CI, perf gates, icon | outline |

Outline plans fix interfaces, contracts, review-focus inputs and the tests that pin them; they are expanded into
write-test / run / implement / run / commit steps when the preceding phase has landed, because their details
depend on what that phase reveals. Execute in order; each plan assumes the previous ones are merged.

**Ledgers.** Each plan is executed with an SDD ledger (`.superpowers/sdd/<plan>/progress.md`: task evidence and every
ruling with its cost-if-wrong). The working copy is ignored by git; when a plan lands, the ledger is copied to
`docs/superpowers/ledgers/<plan>.md` and committed with the branch, so reviews and later plans can rely on it.
