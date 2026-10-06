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

### Sign in and remote vaults

Settings › Identity → **Sign in with Renown**: the engine opens your browser, you sign with your wallet, and the
engine keeps the credential on this computer (`vault/secrets/`, mode 0600) — the app never holds a key. Once signed
in, **Connect remote vault** on the landing takes a Switchboard URL (`https://host/graphql`, `https://host/d/<slug>`
or `https://host/<slug>`) and a drive id or slug, checks what you may do there, and adds the vault; it opens in client
mode, talking to that server as you.

### After rebuilding the vault package

`bun run sync:vault` copies the rebuilt `@powerhousedao/knowledge-note` in and clears Vite's dependency cache
(`host/node_modules/.vite`) — Vite pre-bundles the package and would otherwise keep serving the old build.
