# Implementation plans

| Plan | Phase | Depth |
|---|---|---|
| `2026-10-06-phase0-foundation.md` | 0 — foundation: package host mode, sidecar, host, dev loop, Tauri dev shell, e2e gate | full TDD steps |
| `2026-10-06-phase1-vaults-identity.md` | 1 — designed landing, sign-in, protection switch, settings | full TDD steps |
| `2026-10-06-phase2-pipeline.md` | 2 — pipeline template, models, Workflow Studio | full TDD steps |
| `2026-10-06-phase3-remote-vaults.md` | 3 — remote vaults in client mode, host-provided bearer | outline (expand before execution) |
| `2026-10-06-phase4-conversion.md` | 4 — conversion tiers | outline |
| `2026-10-06-phase5-resilience.md` | 5 — supervisor, backups, upgrades, tray, diagnostics | outline |
| `2026-10-06-phase6-packaging-ci.md` | 6 — installers, CI, perf gates, icon | outline |

Outline plans fix interfaces, contracts, review-focus inputs and the tests that pin them; they are expanded into
write-test / run / implement / run / commit steps when the preceding phase has landed, because their details
depend on what that phase reveals. Execute in order; each plan assumes the previous ones are merged.
