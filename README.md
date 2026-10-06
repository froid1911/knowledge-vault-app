# Desktop Knowledge Vault

A desktop app that runs a Powerhouse Knowledge Vault locally (Tauri shell + Node sidecar + web host).
Design: `docs/superpowers/specs/2026-10-06-desktop-knowledge-vault-design.md`. Plans: `docs/superpowers/plans/`.

## Develop
- `bun install`
- `bun run dev` — sidecar on 4201, host on 4200, Tauri window (`--no-shell` for browser-only)
- `bun run test`, `bun run tsc`, `bun run stack:check`

Requires the vault package checked out at `../bai-knowledge-note` and built there (`bun run build`).

### Demo data

With the dev loop running, seed a vault with real notes, maps and links (for screenshots and manual testing):

```bash
node scripts/seed-demo-vault.mjs --name "Research notes" --size large
node scripts/seed-demo-vault.mjs --name "Team wiki" --size small
```
