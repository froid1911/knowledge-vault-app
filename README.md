# Desktop Knowledge Vault

A desktop app that runs a Powerhouse Knowledge Vault locally (Tauri shell + Node sidecar + web host).
Design: `docs/superpowers/specs/2026-10-06-desktop-knowledge-vault-design.md`. Plans: `docs/superpowers/plans/`.

## Install

Releases are built by merging `dev` into `main` (GitHub Release, marked prerelease until the builds are signed).

- **Linux** — `Knowledge Vault_<version>_amd64.AppImage`: `chmod +x` it and open it (no install needed), or
  `sudo apt install ./Knowledge\ Vault_<version>_amd64.deb`. Needs **glibc 2.34+** (Ubuntu 22.04, Debian 12, Fedora,
  RHEL 9, current Arch and newer) and a desktop's usual libraries — GTK 3 and OpenGL, present on any GNOME, KDE or
  similar desktop; WebKit and Node come inside the AppImage. Verified on a clean Ubuntu 22.04 with only `libgtk-3-0`
  and the GL libraries installed, and on Arch (Omarchy).
- **macOS** (Apple silicon and Intel) — open the `.dmg` and drag the app to Applications. The builds are **not
  signed** yet: the first time, right-click the app → **Open**, then confirm.

The app brings everything it needs: its own Node (24 LTS), the engine (a Powerhouse Switchboard with the vault
package) and the window. Nothing is installed system-wide.

**Where your data lives:** `~/.local/share/xyz.powerhouse.desktop-knowledge-vault/vault/` on Linux,
`~/Library/Application Support/xyz.powerhouse.desktop-knowledge-vault/vault/` on macOS — the vaults (`reactor/`,
`read-model/`), settings (`config.json`), your sign-in (`secrets/`, private), logs, backups and exports. Uninstalling
leaves it; Settings › Vaults › *Delete all local data* removes it.

**Your tools against the app:** Settings › Diagnostics › *Connect your tools* shows the `switchboard init …` line and
the MCP URL for the engine as it runs (the port can change if 4201 is taken).

## Build an installer

- `bun run build:app` — the installer for this machine (`src-tauri/target/release/bundle/`): checks the version
  agrees in `package.json` / `Cargo.toml` / `tauri.conf.json`, builds the host and the engine, stages the engine with
  a production `node_modules` pruned for this platform (`.stage/sidecar/`), fetches the bundled Node (checksum-
  verified, cached in `~/.cache/desktop-knowledge-vault/node/`) and runs `tauri build`.
- `bun run smoke:app` — starts the built AppImage from a throwaway home (`KV_SMOKE=1`): it must start its engine and
  serve its own page, then stop cleanly. Prints sizes, time to ready and peak memory.
- `scripts/build-linux-docker.sh` — the same Linux build inside Ubuntu 22.04, as the release workflow does, into
  `dist-linux/`. **This is the build to share**: a build on a newer distribution (Arch: glibc 2.44 → needs 2.39) links
  against its newer glibc and does not run on older ones; the 22.04 build needs 2.34.
- macOS installers are built by the release workflow (macOS runners); there is no cross-build.

## Develop
- `bun install`
- `bun run dev` — sidecar on 4201, host on 4200, Tauri window (`--no-shell` for browser-only)
- `bun run test`, `bun run tsc`, `bun run stack:check`, `bun run versions:check`, `bun run e2e`
- Tauri's build script needs the bundle's inputs even in development; `bun run dev` provides them
  (`bun run bundle:inputs`: the bundled Node, and a placeholder where the staged engine goes).

### The vault package

The app consumes the **published** `@powerhousedao/knowledge-note` (pinned in `host/package.json` and
`sidecar/package.json`, resolved from the Powerhouse registry — `bunfig.toml` / `.npmrc` route the `@powerhousedao`
scope to `https://registry.vetra.io`, which also proxies the stack). Upgrading the vault app is a version bump plus
`bun install`.

To iterate on the vault package itself, point both dependencies at your checkout for the session —
`"@powerhousedao/knowledge-note": "file:../../bai-knowledge-note"` — run `bun install`, and after each rebuild there
clear Vite's dependency cache (`rm -rf host/node_modules/.vite`; Vite pre-bundles the package and would otherwise keep
serving the old build). Switch back to the published version before committing: CI and release builds need a
version, not a path.

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

