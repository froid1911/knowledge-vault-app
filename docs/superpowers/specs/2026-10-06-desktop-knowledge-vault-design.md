# Desktop Knowledge Vault — design

Date: 2026-10-06 · Repo: `desktop-knowledge-vault` · Status: approved section by section in conversation; this written form is under review.

## 1. Purpose and scope

A self-contained desktop application that runs a Powerhouse Knowledge Vault **locally** — its own reactor (Switchboard), graph indexer, workflow runtime with the extraction pipeline, and the existing Knowledge Vault drive app — and can also open a **remote vault as a client** (for example `https://switchboard.knowledge-vault.vetra.io/graphql`, drive `c5893e1b-854b-49b1-b8aa-6b133ab87969`) when the user is authorised through their Renown login.

Audience: the team first (Linux and macOS builds), end users later.

### Success criteria (v1)
- First launch to a usable empty local vault with no terminal, no Connect, no CLI, no sign-in, in ≤ 60 s including the sidecar start.
- Queue a pasted source → notes appear locally, produced by the pipeline with the user's LLM key.
- The hosted vault opens after a Renown sign-in performed in the system browser; an unauthorised user sees an actionable message.
- Boot → GraphQL ready ≤ 10 s and idle RSS ≤ 1 GB on a ~2.5k-document vault (spike baseline: 6.0 s / 829 MB, §12).
- Linux `.AppImage`/`.deb` and macOS `.dmg` built by CI from `main`, and the same build reproducible locally.

### Non-goals (v1)
Replicating a remote vault locally (client mode only — not designed for later either); Windows build; signed/notarised installers and auto-update; single-binary packaging; any Rust reimplementation of the reactor; sync between two local vaults; a user-chosen data-directory location (fixed per platform in v1); in-app analytics (none, ever — see §2).

## 2. Decisions

| Topic | Decision |
|---|---|
| Local identity | **Open** by default: auth tables off, no sign-in. A **Protect local vaults** switch turns the Switchboard's four auth flags on, makes the signed-in user admin and restarts the sidecar. The flags are process-wide, so protection applies to all local vaults at once (see §4.4). |
| Remote vaults | **Client mode only**: the same UI pointed at the remote Switchboard with the user's bearer. |
| Release target | Linux x64 and macOS (arm64, x64) team builds, unsigned. |
| Pipeline | Runs locally: workflow runtime + our piece + a shipped pipeline template instantiated per vault; LLM endpoint/key from Settings. **Workflow Studio** is reachable from Settings for additional workflows. |
| Conversion | On this computer, without Docker: the docling service as a helper process — text PDFs, Markdown and plain text out of the box; the `docling.rs` binding (Office formats) and the PDF models (scans, OCR) installed on demand; or another server by URL (§6). |
| Architecture | Tauri (Rust) shell + Node sidecar + our own host web app. |
| Code source | `@powerhousedao/knowledge-note` is consumed as a **package**; fixes it needs land in `bai-knowledge-note` and ship as releases. |
| Branching | Work on `dev`; merging to `main` produces the app build and a GitHub Release; the same build runs locally. |
| Telemetry | None in the app; the sidecar's Sentry/OpenTelemetry/Pyroscope stay unset. Nothing leaves the machine unless the user connects a remote vault, a model provider, a converter or signs in. |
| Landing | Designed with the Six Minds audit (§5.7): the most recent vault is the single visual target; first run is one inline action. |

## 3. Architecture

### 3.1 Repository layout

```
desktop-knowledge-vault/
├── src-tauri/        Rust shell: window, app-data dir, sidecar supervisor + env, system-browser launch, tray
├── sidecar/          Node: startSwitchboard(...) with @powerhousedao/knowledge-note + @powerhousedao/workflow; control API; tier-0 converter
├── host/             Vite + React web app: landing, vault list, settings, mounts the vault app, its editors and Workflow Studio
├── assets/           vault-icon.png — the one icon source (Tauri icon set, favicon, landing mark are generated from it)
├── spike/            the 2026-10-06 feasibility probe, read-only reference
├── docs/             this spec, plans, ADR-style notes
└── package.json      bun workspace; every @powerhousedao/* pinned to ONE stack version (6.2.3-dev.44 today)
```

### 3.2 Processes at runtime

1. **Tauri shell (Rust).** Resolves the app-data dir, reads `config.json`, picks free loopback ports (defaults: host 4200, sidecar 4201, control 4202 — never 4001/3001, fall back upward if busy), serves `host/dist` over loopback HTTP, spawns the sidecar with its environment, and relays the sidecar's readiness and status to the webview. It also opens the system browser for sign-in, manages the tray.
2. **Sidecar (Node, bundled runtime).** Boots the Switchboard: PGlite on plain on-disk data dirs, workflows on, MCP on, telemetry off, auth per the local protection setting. Exposes a loopback **control API** (§4.6) for the shell and the host. Prints one readiness line.
3. **Webview.** Loads the host from `http://127.0.0.1:<hostPort>` and talks to the sidecar over GraphQL, REST and the WebSocket change feed on `http://127.0.0.1:<sidecarPort>`. A remote vault is the same client code pointed at `https://switchboard.<…>` with the user's bearer. **There is no reactor in the browser**, hence no IndexedDB replica and no sync channels.

### 3.3 App-data directory

The OS app-data directory — Linux `~/.local/share/xyz.powerhouse.desktop-knowledge-vault/`, macOS `~/Library/Application Support/xyz.powerhouse.desktop-knowledge-vault/` (the Tauri identifier) — is **shared with the webview's own profile**: WebKitGTK and WKWebView write `CacheStorage/`, `databases/`, `hsts-storage.sqlite`, `mediakeys/`, … there. Everything the engine owns therefore lives one level down, in `vault/`, so backups, the store guard and "Delete all local data" operate on a directory that is ours alone:

```
vault/
  reactor/          PGlite data dir (reactor store)
  read-model/       PGlite data dir (read models, graph index, embeddings, workflow runtime)
  attachments/
  backups/<date>-<stackVersion>/
  converter/        node_modules/ (the docling.rs binding + its platform package), models/ (the PDF models), binding.json, downloads/
  secrets/          mode 0700 — app.keypair.json, user.keypair.json, user.credential.json, workflows.key, llm.key (each 0600)
  logs/             sidecar.log (rotated), shell.log
  .ph/              what the Renown SDK and the registry cache write relative to cwd (the engine runs with cwd = vault/)
  config.json
```

The sidecar creates this layout itself (`prepareDataDir`) with `umask 077`, so every file the engine writes is private to the user.
### 3.4 Dependency direction and versions

This repo depends on the **published** `@powerhousedao/knowledge-note` and imports only its exports: `./editors` (drive app + 10 editors, browser build) in the host; `./subgraphs`, `./processors`, `./pieces`, `./document-models`, `./manifest` in the sidecar; `./pieces/knowledge-vault/templates` (new, §7.5). Likewise `@powerhousedao/workflow` (`./editors` for Workflow Studio, server side for the models and runtime), `@powerhousedao/switchboard`, `@powerhousedao/reactor-browser`, `@powerhousedao/design-system`. During development `"@powerhousedao/knowledge-note": "file:../bai-knowledge-note"` links the local checkout (as `condo-fusion` links `condo`); CI and releases pin the published version. Every `@powerhousedao/*` package is pinned to one stack version; a mismatch is a build error.

## 4. Sidecar

### 4.1 Entry and options

`sidecar/src/main.ts` (TypeScript compiled with `tsc`; `node_modules` ships alongside, no bundler) calls `startSwitchboard` from `@powerhousedao/switchboard/server` with:
`packages` = the **directories** of `@powerhousedao/knowledge-note` and `@powerhousedao/workflow` inside the sidecar's own `node_modules` — never bare names: the loader resolves a name from `cwd/node_modules`, the engine runs with cwd = the data dir, and a link into app-data to bridge that can dangle when the code moves — `disableLocalPackages: true`, `dev: false`, `mcp: true`, `workflows: { enabled: true }`, `strictPort: true`, `fatalErrorShutdown: true`, `identity` per §4.4. It never loads a `.env`; the shell passes every variable explicitly.

### 4.2 Environment matrix

| Variable | Open (default) | Protected | Notes |
|---|---|---|---|
| `PORT` | sidecar port | same | loopback-only once the upstream `host` option exists (§4.7) |
| `PH_REACTOR_DATABASE_URL` | `<appdata>/reactor` | same | plain PGlite data dir (§4.3) |
| `DATABASE_URL` | `<appdata>/read-model` | same | read models, graph index, embeddings, workflow runtime |
| `PH_SWITCHBOARD_PUBLIC_URL`, `PUBLIC_URL` | `http://127.0.0.1:<port>` | same | attachment and public URLs (reactor-api reads `PUBLIC_URL`) |
| `AUTH_ENABLED`, `REQUIRE_AUTHENTICATED_CALLER`, `DEFAULT_PROTECTION`, `DOCUMENT_PERMISSIONS_ENABLED` | `false` | `true` | the four flags from the vault's `.env` |
| `ADMINS` | empty | the signed-in user's address | |
| `PH_WORKFLOWS_ENABLED` | `1` | `1` | |
| `PH_WORKFLOWS_SECRETS_MASTER_KEY` | from `secrets/workflows.key` | same | generated once |
| `PH_WORKFLOWS_EGRESS_ALLOW_ADDRESSES` | `127.0.0.1/32,::1/128` + the model endpoint host | same | empty of remote hosts in local-only mode |
| `SWITCHBOARD_APP_NAME` | `desktop-knowledge-vault` | same | signer app label in Activity |
| `MCP_ENABLED` | `true` | `true` | CLI, plugin and agents work against the local vault |
| `SENTRY_DSN`, `ENABLE_TRACING`, `PYROSCOPE_SERVER_ADDRESS` | unset | unset | telemetry off |
| `CONVERT_SERVICE_URL` | unset | unset | replaced by the runtime setter (§7.4) |
| `KV_CONTROL_PORT`, `KV_CONTROL_TOKEN` | set | set | control API bind port and per-launch secret (§4.6) |

Not carried over from the vault's `.env`: `TYPESAFE_API_KEY` (unused by the code) and `CONVERT_SERVICE_URL` (replaced by the runtime setter, §7.4).

**Inheritance is an allowlist** (`sidecar/src/environment.ts`). The engine's environment is the matrix above plus what any process needs from the OS and the user's session — `PATH`, `HOME`, locale, `TMPDIR`, the display and D-Bus variables the system-browser sign-in needs, TLS and proxy settings, the Windows basics, and our own `KV_*` — and nothing else. A developer's exported `SENTRY_DSN`, a `PH_*` or `DATABASE_URL` from another project, an `OPENAI_API_KEY` or a `NODE_OPTIONS` preload never reach the engine, whoever spawned the sidecar: the sidecar applies the allowlist to its own process before starting the Switchboard, so neither the shell nor the dev loop needs scrubbing of its own.

### 4.3 Storage

Both stores are PGlite on plain on-disk data directories — the variant that measured 829 MB idle against 3.66 GB for today's snapshot filesystem (§12). The Switchboard hardcodes `AtomicNodeFs`; the sidecar registers a module-loader hook mapping `@powerhousedao/pglite-fs` to a shim whose `AtomicNodeFs` is PGlite's `NodeFS` (the spike's `nodefs-shim.mjs`), until upstream exposes a data-dir option (§8). PGlite `relaxedDurability` stays `false`.

### 4.4 Identity and the protection switch

- **Open:** auth flags off. The sidecar signs with an **app keypair** (`secrets/app.keypair.json`, generated at first run), so every local operation still carries a consistent signer and the Activity view reads "desktop-knowledge-vault · did:key…".
- **Protected:** auth flags on, `ADMINS` = the signed-in user's address, and the sidecar's `identity` is the **user keypair + Renown credential** stored by the sign-in flow (§5.4), so local writes carry the user's identity exactly as `ph login` + CLI writes do today. Requires a signed-in user; the switch is disabled otherwise.
- The flags are process-wide: **the switch protects all local vaults together**, and the UI says so ("Protect local vaults — requires sign-in"). Switching restarts the sidecar (a few seconds, the host shows the state). Auth tables are created on the first protected start and remain when switched back; this is harmless.

### 4.5 Workflows and the pipeline template

`PH_WORKFLOWS_ENABLED=1`; the master key is generated once into `secrets/workflows.key`. On first run the sidecar creates the **Workflows** drive (`preferredEditor: workflow-studio`, as Vetra does). When the host creates a vault, the sidecar instantiates the **pipeline template** (§7.5) in that drive: a `powerhouse/connection` whose base URL is the local origin and whose LLM key references the secret saved from Settings, and a `powerhouse/workflow` bound to the new drive, published and with its trigger enabled. Settings → Workflows opens Workflow Studio on the Workflows drive inside the app.

### 4.6 Control API and lifecycle

The sidecar also listens on `127.0.0.1:<controlPort>`; every request must carry `KV_CONTROL_TOKEN` (a per-launch secret the shell generates and passes by environment), so other local processes cannot drive it. Routes: `GET /status`, `POST /auth/login` (returns the Renown URL to open; the sidecar polls the Renown session and stores keypair + credential in `secrets/`), `GET /auth/status`, `POST /auth/logout`, `GET /auth/token?aud=` (mints a short-lived bearer from the user keypair for the host's remote-vault calls), `POST /vaults` (create a local vault drive with `preferredEditor: knowledge-vault` and instantiate the pipeline template), `POST /converter/config`, `POST /shutdown`. The Node side owns identity because `@renown/sdk/node` already implements the system-browser session flow.

Readiness: one stdout line `{"event":"ready","port":4201,"controlPort":4202}` after `/health` is green. Shutdown: the shell sends SIGINT and waits up to 15 s (PGlite flush), then SIGKILL. Logs: `logs/sidecar.log`, rotated at 10 MB × 5.

### 4.7 Networking prerequisite

The Switchboard's HTTP adapter accepts a bind host but nothing supplies one (`startServer` calls `listen(port, tls)`), so the engine would bind every interface — and in open mode every anonymous caller is the owner. The sidecar therefore installs a loopback-only `listen` shim for the engine's port before starting it (`sidecar/src/loopback.ts`, pinned by its test): an *open* local vault is reachable from this computer only. The upstream `host` option (§8) retires the shim; protected mode is unaffected either way.

## 5. Host web app

### 5.1 Stack and serving

Vite + React 19 + TypeScript; `@powerhousedao/reactor-browser` and `@powerhousedao/design-system` as libraries; the vault app and editors from `@powerhousedao/knowledge-note/editors`; Workflow Studio from `@powerhousedao/workflow/editors`. Served by the shell over loopback HTTP (`tauri-plugin-localhost` or a small axum static server) so the origin is an ordinary `http://127.0.0.1:<hostPort>`; the same build runs in a normal browser against a running sidecar during development.

### 5.2 Screens

1. **Landing / vault picker** — branded: local vaults (name, note count, last activity, protected badge), remote vaults, *New local vault*, *Connect remote vault* (Switchboard URL + drive id or slug), sign-in state, sidecar state while starting.
2. **Vault** — the unchanged Knowledge Vault drive app full-window, its 10 document editors mounted by document type (as Connect's `useEditorModules` does), plus a slim app bar: back, vault name, protected badge, identity.
3. **Settings** — *Identity* (sign in/out via the system browser, address/DID, credential expiry, renew); *Models* (one OpenAI-compatible endpoint + key, or a local endpoint such as Ollama/LM Studio, shared by chat and pipeline; *local-only mode*); *Vaults* (protect switch, rename, delete, back up/restore, export as documents); *Conversion* (§6); *Workflows* (Workflow Studio); *Diagnostics* (engine status, ports, store sizes, logs, re-index, copy diagnostics, and **Connect your tools**: the `switchboard init --url http://127.0.0.1:<port>/graphql --name local-vault` line and the MCP URL `http://127.0.0.1:<port>/mcp`, with the note that protected mode needs `switchboard auth login --token "$(ph access-token)"`); *About* (app, stack and package versions; an **update notice** that checks the GitHub Releases feed on launch and links to the download — there is no auto-update in v1).


**As built (Phase 1-lite, 2026-10-06).** No app-level sidebar: the Six Minds audit found the shell's top-level areas are not peers (the vault is the destination; Settings and Workflows are side quests), and a landmark that must vanish inside a vault is the wrong landmark. The landing header carries *Workflows*, the identity chip (or *Sign in*) and ⚙; inside a vault or Workflow Studio only the app bar remains (← Vaults · title · ⚙). Settings is a full page whose left column lists its sections (Vaults · Appearance · Models · Workflows · Diagnostics · About · Identity) — there the sections *are* peers. Tiles carry a ⋯ menu (Open · Rename · Delete; Remove for a remote vault); delete needs the vault's name typed and the engine deletes the drive with everything in it. Routes are hash routes (`#/`, `#/vault/:id`, `#/remote/:id`, `#/workflows`, `#/settings/:section`): a desktop webview reloads at the app root.

### 5.3 Wiring contract

At boot the host installs the globals the vault app expects, all exported by `reactor-browser`: `setReactorClientModule`/`setReactorClient(new GraphQLReactorClient(origin, bearerProvider))`, `setDocumentCache(remote-first cache)`, `setDrives([...])`, `setSelectedDrive`/`setSelectedNode` driven by the router (`/vault/:driveId/*`), `setPHAppConfig` (including the Switchboard origin override, §7.1), `RenownProvider`. Symbols the app imports and the host must satisfy (from the audit): `setSelectedNode`, `useSelectedDriveId`, `useSelectedDrive`, `useSelectedNode`, `useNodesInSelectedDrive`, `useNodesInSelectedDriveOrFolder`, `useFileNodesInSelectedDrive`, `useDocumentById`, `useDocumentOperations`, `dispatchActions`, `useDrives`, `useSync` (must be a no-op without a sync manager), `useRenownAuth`, `RenownAuthButton`, `ambientRenownTokenProvider`, `usePHToast`, `useTheme`, `useSetPHAppConfig`, `showCreateDocumentModal`, `setAttachmentService`, plus `DocumentToolbar` and the revision-history panel from `@powerhousedao/design-system/connect`. Switching vault = switching the client's origin and bearer; there is never a local reactor or sync manager.

### 5.4 Sign-in

"Sign in" → `POST /auth/login` on the control API → the shell opens the returned Renown URL in the **system browser**, where the user signs with their wallet → the sidecar polls the Renown session, then `renown.login(did)` fetches a delegation credential for the local user keypair → keypair and credential land in `secrets/` → the host learns the identity from `/auth/status`. Bearers for remote vaults come from `/auth/token`. Credential expiry (7 days) is shown in Settings with a one-click renew (same flow). No wallet is ever needed inside the webview.


**As built.** `sidecar/src/identity.ts` runs the Renown SDK's browser flow (`browserLogin`: the engine opens the system browser, the SDK polls), keeps the user's key and credential under `vault/secrets/` (0600), and mints bearers locally with `generateAccessToken` — what `ph access-token` does. Control routes `/auth/status|login|cancel|logout|token`. Settings › Identity drives it, with the sign-in link as a fallback when the browser did not open, and polls while a sign-in is pending. The vault package reads the host's identity and bearer through the host-config contract (`identity`, `bearer`; `useVaultIdentity`), so its gate, Access view and live feed act as that user. The Renown instance is built with `revalidate: "never"` so the app starts offline; every Switchboard verifies the credential on each request anyway.

### 5.5 Remote vaults

A remote vault is a `config.json` entry `{kind:"remote", name, switchboardUrl, driveId}`. Opening it sets the origin override and the bearer provider; drive metadata is read from the remote Switchboard (`GET /d/<id>` and the drive document). Authorisation failure shows "ask the vault's administrator for READ on this drive" with the user's address.


**As built.** The address a person pastes may be `https://host/graphql`, `https://host/d/<slug>`, `https://host/<slug>` or the origin plus a drive id/slug (`parseRemoteVaultInput`). The engine checks the drive as the signed-in user — `GET /d/<drive>` with the bearer, then `canExecuteOperation(ADD_FILE)` for read vs write — and keeps remote entries in `config.json` `vaults[]`; routes `/remote-vaults`, `/remote-vaults/check`. The host opens a remote vault in client mode: a `GraphQLReactorClient` for that origin with a cached, engine-minted bearer (`tokenProvider`), the host declaration switched to that origin with `bearer` and `identity`, the local engine restored on leaving. The hosted Switchboard answers CORS with `access-control-allow-origin: *` (authorization allowed), so the webview talks to it directly; no proxy.

### 5.6 Configuration file

```json
{
  "version": 1,
  "stackVersion": "6.2.3-dev.44",
  "ports": { "host": 4200, "sidecar": 4201, "control": 4202 },
  "local": { "protected": false },
  "models": { "endpoint": "https://openrouter.ai/api/v1", "model": "…", "localOnly": false },
  "conversion": { "mode": "builtin", "url": null, "autoStart": false },
  "vaults": [
    { "kind": "local",  "id": "<driveId>", "name": "My vault", "createdAt": "…" },
    { "kind": "remote", "id": "c5893e1b-…", "name": "powerhouse-knowledge", "switchboardUrl": "https://switchboard.knowledge-vault.vetra.io/graphql" }
  ],
  "ui": { "closeToTray": true, "theme": "dark" }
}
```
Secrets are never in this file; `models.keyRef`-style values point into `secrets/`.

`ui.theme` is `dark` by default — the vault app's own default — with `light` and `system` offered in Settings. The host keeps the choice where `reactor-browser` reads it (`localStorage` key `ph:theme`, the store behind `useTheme()`/`setTheme()`), so the shell and the mounted vault app can never disagree; `index.html` applies the stored or default theme to `<html>` before first paint, so there is no white flash.

### 5.7 Landing and first-run design

Designed with the Six Minds audit (vision, wayfinding, memory, language, decision, emotion) and reviewed against generic defaults.

**Audience and job.** Team members first (they know notes, maps of content, sources, pipeline), end users later. The landing's one job: get the person into a vault fast and tell them, without jargon, that the local engine is ready. The screen is the app's front door, never a workspace: inside a vault a slim app bar with **← Vaults** returns here.

**Cognitive audit (summary).**
- *Vision:* for a returning user the single target is the most recently opened vault — the largest tile, highest contrast, pre-focused; everything else is quiet. On first run the single target is the inline **Create your first vault** field.
- *Wayfinding:* three fixed landmarks — header (app name left, identity right), the vault tiles as the main area, an engine status strip at the bottom. Vault switching always passes through this screen; there is no second drive list anywhere.
- *Memory:* the vocabulary and the picker pattern people already know — Obsidian's vault picker and VS Code's welcome page: recent first, "New vault", "Open". Gear for settings, lock for protected, green dot for running.
- *Language:* primary UI says Vault, Notes, Sources, Pipeline, Processing, Sign in, Protected, Remote vault. Never Switchboard, sidecar, reactor, drive, PGlite, bearer. Expert terms appear only where experts need them: the remote-vault form labels its fields **Vault server (Switchboard URL)** and **Drive id or slug**; Diagnostics speaks the engineering vocabulary.
- *Decision:* the microgoals in order — Is it ready? → Which vault? → (none) Create one, which needs only a name → Open. Model setup for processing is **not** a prerequisite: creation never blocks on it; a non-blocking banner inside the new vault says "Set up a model to process sources automatically" and links to Settings › Models. Connecting a remote vault asks for sign-in first, then the address, then checks access and shows the result (drive name and READ/WRITE/none) before adding.
- *Emotion:* appeal — each vault tile carries a small live constellation of that vault's own graph (real node positions from the saved layout; a quiet generative constellation until the first notes exist). Enhance — fast, local, offline, nothing to install. Awaken — "a thinking system you own". Anxieties addressed in place: the status strip's one sentence "Everything stays on this computer unless you connect a remote vault, a model provider or a converter" (with a link to Settings), the protected lock explained on hover, and Back up visible in Settings › Vaults.

**Concepts evaluated.** *A Minimal list* (rows + two buttons, fastest, emotionally flat) · *B Welcome page* (recent + start actions + status column; conventional, predictable, a little busy) · *C Immersive* (full-bleed graph of the last vault as hero; strong appeal, weak wayfinding, slow first paint). **Chosen: B's structure, A's single pre-focused target, C's constellation confined to the tiles.** The constellation tile is the one place boldness is spent; everything around it is disciplined.

**Visual plan (tokens).**
- *Palette:* **the vault app's own tokens, dark by default.** The host imports the package's `style.css` and carries `data-bai-theme` on its root, so every colour the shell uses is a `var(--bai-*)` the app already defines — the landing and the vault must read as one application, and no colour may be defined in the host that the app does not define first. Dark (the default, and the app's own default) is the app's Catppuccin Mocha set: page `--bai-bg` `#1e1e2e`, panels `--bai-surface` `#181825`, depth `--bai-deep` `#11111b`, hover `--bai-hover` `#313244`, text `--bai-text` `#e4e4e7` with `--bai-text-secondary/-tertiary/-muted/-faint`, hairlines `--bai-border`, accent `--bai-accent` `#cba6f7` (focus ring, primary action, constellation nodes). Light is the app's `[data-bai-theme="light"]` set, untouched. Attention colours reuse the app's status tokens: the protected lock in `--bai-status-draft` (amber), ready in `--bai-status-canonical` (green), errors in `--bai-danger`. Graph node colours are inherited from the vault app's graph (one per note type) so tiles and the real graph agree. Rejected: a second palette for the shell (an earlier draft proposed paper/ink and slate/chalk with an ink-wash blue — dropped because the shell would have disagreed with the app it frames), cream + terracotta, near-black + acid green, identical rounded cards with one shadow.
- *Type:* Inter for UI (continuity with the vault app) and a humanist serif (Source Serif 4) for vault names only — the one typographic moment; no all-caps labels, no eyebrows, no middle-dot meta strings (tile metadata is a sentence: "2,165 notes, opened 2 days ago").
- *Layout:* left-aligned, content max-width 1040 px, 24 px grid; window minimum 960 × 640. Tiles vary by recency: the most recent spans two columns with a larger constellation; others are single. Remote vaults sit in the same grid with a small "remote" mark, not in a separate section.
- *Motion:* one orchestrated moment — when the engine reports ready, each tile's constellation settles into its saved positions once (disabled under reduced motion). No hover animation on tiles; focus is a visible 2 px ring in `--bai-accent`.
- *Copy:* sentence case, active verbs, the same word through a flow ("New vault" → "Create vault" → toast "Vault created"). Errors say what happened and what fixes it ("The engine could not start: port 4201 is in use. Change the port in Settings › Diagnostics.").

**Wireframe — returning user.**
```
┌──────────────────────────────────────────────────────────────────────────┐
│ Knowledge Vault                                        0x7A3…c4 ▾  ⚙     │
├──────────────────────────────────────────────────────────────────────────┤
│  Vaults                                       New vault   Connect remote │
│                                                                          │
│  ┌──────────────────────────────────┐  ┌───────────────┐ ┌─────────────┐ │
│  │ ·  ·    ·  ╱·   constellation    │  │ ·  ·· ·       │ │ · ·    ·    │ │
│  │   ·  ·╲ ·     ·   ·   ·  ·       │  │  ·  ·  ·      │ │  ·   ··   · │ │
│  │ Research notes          (serif)  │  │ Team wiki  🔒 │ │ powerhouse- │ │
│  │ 2,165 notes, opened 2 days ago   │  │ 371 notes     │ │ knowledge ⇅ │ │
│  │                         [ Open ] │  │ Sign in to    │ │ remote      │ │
│  └──────────────────────────────────┘  │ open          │ └─────────────┘ │
│                                        └───────────────┘                 │
├──────────────────────────────────────────────────────────────────────────┤
│ ● Ready   Everything stays on this computer unless you connect a remote  │
│           vault, a model provider or a converter.  Settings    v0.1.0    │
└──────────────────────────────────────────────────────────────────────────┘
```
**Wireframe — first run.**
```
│  Create your first vault                                                 │
│  ┌──────────────────────────────────────────────────────────────┐        │
│  │ Name   [ Research notes                     ]  Create vault  │        │
│  └──────────────────────────────────────────────────────────────┘        │
│  Already have a vault on a server?  Connect a remote vault               │
│                                                                          │
│ ◐ Starting the engine — opening your store…                              │
```
Enter in the name field creates and opens the vault. While the engine starts, the field is editable and the button waits with the live step shown; nothing else competes for attention.

**Six Minds mapping.** *Vision:* one largest, pre-focused tile; tiles are the only coloured elements. *Wayfinding:* header / tiles / status strip never move; ← Vaults inside a vault. *Memory:* Obsidian/VS Code picker schema, gear, lock, green dot. *Language:* user vocabulary in primary UI, expert terms only in the remote form and Diagnostics. *Decision:* ready → which vault → create (name only) → open; model setup deferred and offered in place. *Emotion:* the vault's own constellation as appeal; privacy sentence, lock explanation and Back up as anxiety relief.

### 5.8 Desktop webview integration

- **File intake.** Tauri's own drag-and-drop handler is disabled (`dragDropEnabled: false`) so HTML5 drop events reach the vault app's intake; a native file picker (dialog plugin) is offered beside it.
- **Links and files.** External links open in the system browser — built: the opener plugin, a shell navigation guard that refuses any full-page navigation away from the app and opens it externally, and a host interceptor for anchors and `window.open` (so an OAuth redirect can never replace the app); exports and backups use native save dialogs; the clipboard is allowed for the app's copy actions.
- **Window.** One main window, minimum 960 × 640, state (size, position, maximised) persisted; theme is dark by default (the vault app's own default) with light and system as overrides in Settings — `<html>` carries the `dark` class and `color-scheme: dark` before first paint; close-to-tray configurable (default on) so the engine keeps serving the CLI and agents.
- **Webview parity checks** (Phase 0): WebGL for the PixiJS graph, WASM and WebSocket on WebKitGTK and WKWebView; keyboard focus visible everywhere; `prefers-reduced-motion` respected.

## 6. Document conversion

Documents convert **on this computer, without Docker**. The converter is the user's own docling service (`@powerhousedao/docling-service`, repo `docling`), vendored into the sidecar (`sidecar/converter/`) and run by the app's bundled Node as a helper process on a free loopback port. It starts with nothing installed and grows as components are installed; every state is a *working* service, honestly described by its own `/health`:

| Installed (app-data `converter/`) | Converts | Download | Memory when on |
|---|---|---|---|
| nothing — Stage A, shipped | pasted text, `.md`/`.txt`, **text PDFs** through the pdf.js text layer (`textSource: "pdfjs"`). A PDF without a readable text layer is refused with the remedy (`NEEDS_CONVERTER`), never an empty source; other formats answer `BINDING_REQUIRED` | 0 | ~50 MB |
| + the `docling.rs` binding (Settings › Conversion › *Install binding*) | plus `docx`, `xlsx`, `pptx`, `csv`, `epub`, `html`, … | 56–71 MB (npm registry tarballs, integrity-checked, resumable) | ~50 MB |
| + the PDF models (*Install models*; needs the binding, which verifies them) | plus scanned PDFs, images, layout and tables, OCR | ~720 MB (upstream's download script for the binding's version, pinned by sha256; re-runnable — present files are skipped; the binding verifies the set is complete) | ~0.7–1.4 GB |
| another server, by URL | whatever that service does (a team's container, for example) | 0 locally | 0 |

One setting — *Where documents convert*: **on this computer** (default), **another server** by URL, or **off**. Changing it points the vault package's conversion service at the new place at runtime (§7.4) — no engine restart; an in-flight conversion finishes where it started. The helper is supervised lightly: one automatic restart; then *Not responding* with the exit code and the log (`logs/converter.log`), the engine's URL cleared so `convert/health` says `configured: false`, and a *Restart* action. Settings › Conversion shows the state (*Ready · Starting · Stopped · Not responding*) and one sentence derived from the health answer's `formats`, `binding` and `ready` — never a hard-coded list — and, under *Components*, *Install · Installing n % · Installed · Remove* for the binding and the models — one install at a time — the binding download resumable and integrity-checked against pinned strings, the models fetch re-runnable and verified complete by the binding — the helper restarted afterwards so it loads what arrived.

The models come from the binding's own version: upstream's download script pinned by tag (`v1.58.0`) and sha256 — the `master` script follows the newest binding and dropped pdfium, which 1.5x bindings still need. Memory with the models loaded measured 1.4 GB after the first PDF; *Off* or *Remove* frees it. The models fetch needs `sh`, `curl` and `tar` (Windows gets its own path with its binding).

**macOS:** `docling.rs` publishes no darwin binding — upstream omits it only for lack of macOS runners, not for a technical reason — so Plan 6 builds it on the Mac runners and hosts it with our releases. Until then macOS has the first row and *another server*.

The vendored copy is kept honest by `scripts/sync-converter.mjs` (`--check` fails on drift; `sidecar/converter/SOURCE.json` names the source commit). The service gained a *no-binding mode* for this (`CONVERT_DISABLE_BINDING=1` forces it for tests), which also makes a container without models useful.

## 7. Changes in the vault package (`bai-knowledge-note`)

1. **Switchboard origin as a runtime setting** (`editors/shared/subgraph-endpoint.ts`): a host-provided origin, set per selected vault through the app config, wins over the hostname heuristics; `resolveReactorEndpoint`, `resolveAuthEndpoint`, `resolveKnowledgeGraphEndpoint` and `editors/shared/remote-reactor.ts` follow it. Heuristics remain the fallback for Connect and the hosted vault.
2. **Host-aware boot** (`editors/knowledge-vault/lib/boot.ts`, `lib/remote-memory.ts`, `hooks/use-remote-first.ts`): skip the Connect-specific work (sync-channel neutralising, remembered-drive re-adding, drive-snapshot hydration) when the host declares itself and no sync manager exists. Independently, cap the Switchboard probe with backoff — the spike recorded 250 requests in 100 s against an unreachable origin, a bug in Connect too.
3. **Open mode** (as built): both route guards — `subgraphs/http/lib/authorize.ts` and its mirror `subgraphs/convert/lib/authorize.ts` — accept an anonymous caller only when the host runs with authentication off **and** declares `KNOWLEDGE_VAULT_OPEN_MODE=1` (the sidecar sets it when not protected); the caller is the engine's owner, attributed to the engine's own key (`KNOWLEDGE_VAULT_OPEN_MODE_ADDRESS`, else `local`). A hosted deployment that merely has auth off declares nothing and stays closed. The vault app shows no sign-in gate in open mode (verified by the e2e). Protected mode unchanged.
4. **Conversion service at runtime** (as built): `setConversionServiceUrl(url | null)` swaps the service the `convert` routes read per request — no re-registration, no restart; `null` means none, also over an environment-configured service until the next setup. `ConvertSubgraph.onSetup` binds one live deps object for the process (a reload configures it in place) and publishes the setter on `globalThis[Symbol.for("@powerhousedao/knowledge-note/convert")]` for a host that starts the Switchboard inside its own process; `convert/health` reports `source: env | runtime | null`.
5. **Pipeline template**: the working *Vault pipeline (auto)* workflow and its connection exported once as a template with placeholders (drive id, local origin, LLM secret reference) and shipped at `pieces/knowledge-vault/templates/` behind a new `./pieces/knowledge-vault/templates` export, versioned with the piece.
6. **Relied on, unchanged**: `use-drive-init.ts` (folders and singletons on first open, now through the configurable origin); the embedding model and onnxruntime WASM under `dist/node/`; `SWITCHBOARD_APP_NAME` labelling.

## 8. Upstream requests (with interim workarounds)

| To | Request | Interim |
|---|---|---|
| Powerhouse (`reactor-api`/`switchboard`) | a `host` option so the server can bind `127.0.0.1` | the sidecar's loopback-only `listen` shim for the engine's port (`loopback.ts`) |
| Powerhouse (`switchboard`) | a plain data-dir (NodeFS) storage option instead of `AtomicNodeFs` for local use | the sidecar's loader shim |
| `docling.rs` | a darwin build (omitted upstream only for lack of macOS runners) | Plan 6 builds the darwin binding on our Mac runners; until then macOS has the binding-less tier and *another server* |

## 9. Error handling and resilience

- **Supervisor.** States *starting → opening store → indexing → ready* on the landing page; port in use → next port, reported to the host; crash on boot → log tail with *Open logs* / *Copy diagnostics* (versions, ports, store sizes, last 200 lines, never secrets); crash at runtime → restart with backoff (3 attempts) and a "Reconnecting…" banner; the vault app's `readBack: unconfirmed` semantics cover writes in flight; a stale `postmaster.pid` is cleared before start when no sidecar runs; the single-instance plugin prevents two windows and two sidecars on one store.
- **Store safety and upgrades.** `config.json` records the stack version that last opened the store. A stack bump first backs up both data dirs to `backups/<date>-<version>/` (free-space check), then starts; a PGlite-major migration runs only after that backup. An app older than the store's version refuses to open it. *Back up / Restore* = quiesce the sidecar, zip the data dirs, reverse to restore; *Export as documents* uses the existing REST export.
- **Remote vaults.** 401 → "your sign-in expired" with renew; 403 → the administrator message with the address; offline → explicit banner (client mode has no cache); a server older than dev.35 (missing the renamed GraphQL arguments) is detected by a probe query and reported.
- **Pipeline and models.** Endpoint/key validated on save (a one-token request); run failures surface as a badge in the Pipeline view linking to the run in Workflow Studio; local-only mode blocks egress and says so.
- **Converter.** Explicit states with the one action that fixes each (*Ready · Starting · Stopped · Not responding*; *Restart*); the binding download is resumable and integrity-checked, the models fetch re-runnable and verified by the binding; a format the current install cannot read answers with the remedy, never an empty source.
- **Data retention.** Uninstalling leaves the app-data directory in place; Settings › Vaults › *Delete all local data* removes it after a typed confirmation.
- **Secrets.** `secrets/` at mode 0600 (OS keychain later), never in webview storage; *Sign out* removes the credential; *Reset identity* deletes the user keypair with a warning about attribution continuity.

## 10. Testing

- **Rust:** app-data paths, config read/migrate, port selection, supervisor state machine.
- **Sidecar:** env assembly for both modes, readiness protocol, control API auth, tier-0 converter against the contract (pdfjs fixtures), template instantiation against a fake GraphQL server.
- **Host:** vault/config model, the wiring adapter (the contract in §5.3), sign-in state handling, settings validation.
- **Vault package** (in `bai-knowledge-note`): origin override, host-aware boot, open-mode guard, convert setter.
- **End-to-end (Playwright, real sidecar, empty store):** create vault → folders/singletons present → paste a source → template instantiated and enabled → with a mocked LLM endpoint the pipeline produces notes → search finds them → protect → anonymous call gets 401 → sign in with a mocked Renown session → remote vault 403 path. Landing: first run by keyboard only (type a name, Enter, vault opens); a protected tile prompts sign-in instead of opening; the engine status strip reflects a simulated slow start. One desktop smoke via `tauri-driver` on Linux: launch → landing → create vault → vault app renders → drop a `.md` file onto intake.
- **Performance gates (Linux CI):** boot → ready ≤ 10 s, idle RSS ≤ 1 GB on a generated ~2.5k-document vault (built once with the drive-sync upload script, cached), using the spike's measurement harness. The real store copy is never shipped to CI.

## 11. Build, packaging, CI and branching

- **Local commands:** `bun run dev` (sidecar from source + Vite + `cargo tauri dev`), `bun run build:app` (full installer for the current platform — the same steps CI runs), `bun run test`, `bun run e2e`, `bun run perf`.
- **App icon:** `assets/vault-icon.png` (the Knowledge Vault icon from the vault repo), padded to a 1024 × 1024 transparent square and run through `tauri icon` for every platform size; the same file is the host's favicon and the landing's header mark.
- **Build pipeline:** host (Vite → `host/dist`), sidecar (`tsc` + production-only `node_modules` install), `tauri build`. Node is a per-target external binary downloaded from nodejs.org at build time with checksum verification; `sidecar/`, `host/dist` and the pipeline template are bundled resources; macOS carries a sidecar entitlements file so the Node binary may run inside the bundle.
- **Targets:** Linux x64 `.AppImage` + `.deb`; macOS arm64 and x64 `.dmg`, unsigned. Windows prepared by the layout, not built.
- **Branching:** all work on `dev` (feature branches merge into `dev`); merging `dev` into `main` is the release act.
- **CI:** on every push and PR (`dev`, feature branches): `cargo fmt --check`, `cargo clippy -D warnings`, `bun run tsc`, `bun run lint`, `bun run test`, e2e on Linux. On push to `main`: the matrix build (ubuntu-22.04, macos-14, macos-13) publishes a GitHub Release whose notes list the installer size per target and the pinned `@powerhousedao/knowledge-note` and stack versions. About shows app, stack and package versions.

## 12. Measured baseline (spike, 2026-10-06)

Copy of the dev vault's 2,842-document drive (2,165 graph nodes, 8,458 edges, 102,661 operations), Switchboard dev.44 started programmatically, workflows and auth off:

| Store | Boot → GraphQL | Idle RSS | After queries | Semantic search | Shutdown |
|---|---:|---:|---:|---:|---:|
| PGlite snapshot FS (`ph vetra` today) | 11.6 s | 3,659 MB | 3,971 MB | 89 ms (20–680) | 6.0 s |
| **PGlite plain data dir (chosen)** | 6.0 s | 829 MB | 1,474 MB | 32 ms | 0.5 s |
| Postgres 17 (+~170 MB server) | 5.6 s | 822 MB | 1,391 MB | 19 ms | 0.5 s |
| Empty in-memory store (fixed cost) | 5.4 s | 1,038 MB | — | — | 0.5 s |

The 1 GB snapshot holds ~660 MB of real data (keyframes 319 MB, operations 131 MB, operation index 125 MB). 52 stale polling sync channels in that store replay the whole log on every boot — impossible here because the host runs no browser reactor. Details: `spike/notes/findings.md`.

## 13. Risks and open questions

- **Webview parity.** WebKitGTK (Linux) and WKWebView (macOS) must run the vault app's PixiJS/WebGL graph and its WASM; verified early in Phase 0 with the real app.
- **`reactor-browser` behaviours outside Connect.** The setters are exported, but hooks such as `useSelectedNode`, modals (`showCreateDocumentModal`) and toasts may assume Connect's providers; the host supplies equivalents and the Phase 0 spike of the vault app inside the host settles the list.
- **Renown session API.** The system-browser flow relies on Renown's session endpoints used by `ph login`; verified in Phase 1 against `www.renown.id`.
- **Template export format.** Exporting the working workflow and connection as a replayable template needs the workflow model's import path; decided in Phase 2.
- **Upstream `host` option.** Until it lands, the sidecar's `listen` shim binds the engine to loopback — the kind of patch an upstream option should retire.
- **Installer size.** Dominated by `node_modules`; measured and trimmed in Phase 6.

## 14. Phases (input to the implementation plan)

0. Repo scaffold; sidecar boots on a plain data dir with the control API skeleton; host skeleton serves the vault app against the sidecar — requires package changes §7.1–7.2 first (in `bai-knowledge-note`, linked locally).
1. Vault creation and first run; landing; identity via the system-browser flow; protection switch (§7.3).
2. Pipeline: template export (§7.5), instantiation, Models settings, Workflow Studio mount.
3. Remote vaults.
4. Conversion without Docker (§6, §7.3–7.4): Stage A — the service's no-binding mode, the open-mode guard, the runtime conversion service, the helper and Settings › Conversion (landed 2026-10-06); Stage B — the binding and the models installable from Settings (landed 2026-10-06); the darwin binding in Plan 6.
5. Resilience: supervisor, backups, upgrade guard, diagnostics, tray.
6. Packaging, CI, e2e and performance gates; macOS builds.
