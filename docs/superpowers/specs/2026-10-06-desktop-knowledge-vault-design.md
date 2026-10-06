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
| Conversion | Optional and tiered: built-in pdfjs baseline; native `docling.rs` sidecar (Linux/Windows) installed on demand; Docker container; or a remote URL. |
| Architecture | Tauri (Rust) shell + Node sidecar + our own host web app. |
| Code source | `@powerhousedao/knowledge-note` is consumed as a **package**; fixes it needs land in `bai-knowledge-note` and ship as releases. |
| Branching | Work on `dev`; merging to `main` produces the app build and a GitHub Release; the same build runs locally. |
| Telemetry | None in the app; the sidecar's Sentry/OpenTelemetry/Pyroscope stay unset. Nothing leaves the machine unless the user connects a remote vault, a model provider, a converter or signs in. |
| Landing | Designed with the Six Minds audit (§5.7): the most recent vault is the single visual target; first run is one inline action. |

## 3. Architecture

### 3.1 Repository layout

```
desktop-knowledge-vault/
├── src-tauri/        Rust shell: window, app-data dir, sidecar supervisor + env, system-browser launch, tray, Docker control
├── sidecar/          Node: startSwitchboard(...) with @powerhousedao/knowledge-note + @powerhousedao/workflow; control API; tier-0 converter
├── host/             Vite + React web app: landing, vault list, settings, mounts the vault app, its editors and Workflow Studio
├── assets/           vault-icon.png — the one icon source (Tauri icon set, favicon, landing mark are generated from it)
├── spike/            the 2026-10-06 feasibility probe, read-only reference
├── docs/             this spec, plans, ADR-style notes
└── package.json      bun workspace; every @powerhousedao/* pinned to ONE stack version (6.2.3-dev.44 today)
```

### 3.2 Processes at runtime

1. **Tauri shell (Rust).** Resolves the app-data dir, reads `config.json`, picks free loopback ports (defaults: host 4200, sidecar 4201, control 4202 — never 4001/3001, fall back upward if busy), serves `host/dist` over loopback HTTP, spawns the sidecar with its environment, and relays the sidecar's readiness and status to the webview. It also opens the system browser for sign-in, manages the tray, and controls the Docker converter.
2. **Sidecar (Node, bundled runtime).** Boots the Switchboard: PGlite on plain on-disk data dirs, workflows on, MCP on, telemetry off, auth per the local protection setting. Exposes a loopback **control API** (§4.6) for the shell and the host. Prints one readiness line.
3. **Webview.** Loads the host from `http://127.0.0.1:<hostPort>` and talks to the sidecar over GraphQL, REST and the WebSocket change feed on `http://127.0.0.1:<sidecarPort>`. A remote vault is the same client code pointed at `https://switchboard.<…>` with the user's bearer. **There is no reactor in the browser**, hence no IndexedDB replica and no sync channels.

### 3.3 App-data directory

Linux `~/.local/share/desktop-knowledge-vault/`, macOS `~/Library/Application Support/desktop-knowledge-vault/`:

```
reactor/          PGlite data dir (reactor store)
read-model/       PGlite data dir (read models, graph index, embeddings, workflow runtime)
attachments/
backups/<date>-<stackVersion>/
converter/        native docling.rs binding + ONNX weights (tier 1), when installed
secrets/          app.keypair.json, user.keypair.json, user.credential.json, workflows.key, llm.key   (mode 0600)
logs/             sidecar.log (rotated), shell.log
config.json
```

### 3.4 Dependency direction and versions

This repo depends on the **published** `@powerhousedao/knowledge-note` and imports only its exports: `./editors` (drive app + 10 editors, browser build) in the host; `./subgraphs`, `./processors`, `./pieces`, `./document-models`, `./manifest` in the sidecar; `./pieces/knowledge-vault/templates` (new, §7.5). Likewise `@powerhousedao/workflow` (`./editors` for Workflow Studio, server side for the models and runtime), `@powerhousedao/switchboard`, `@powerhousedao/reactor-browser`, `@powerhousedao/design-system`. During development `"@powerhousedao/knowledge-note": "file:../bai-knowledge-note"` links the local checkout (as `condo-fusion` links `condo`); CI and releases pin the published version. Every `@powerhousedao/*` package is pinned to one stack version; a mismatch is a build error.

## 4. Sidecar

### 4.1 Entry and options

`sidecar/src/main.ts` (TypeScript compiled with `tsc`; `node_modules` ships alongside, no bundler) calls `startSwitchboard` from `@powerhousedao/switchboard/server` with:
`packages: ["@powerhousedao/knowledge-note", "@powerhousedao/workflow"]`, `disableLocalPackages: true`, `dev: false`, `mcp: true`, `workflows: { enabled: true }`, `strictPort: true`, `fatalErrorShutdown: true`, `identity` per §4.4. It never loads a `.env`; the shell passes every variable explicitly.

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

The Switchboard's HTTP server calls `.listen(port)` without a host and therefore binds every interface; an *open* local vault would be reachable from the LAN. A small upstream change (a `host` option, §8) fixes this. Until it lands, the shell starts an open vault only after the user acknowledges the exposure once, and protected mode is unaffected (every call needs a bearer).

## 5. Host web app

### 5.1 Stack and serving

Vite + React 19 + TypeScript; `@powerhousedao/reactor-browser` and `@powerhousedao/design-system` as libraries; the vault app and editors from `@powerhousedao/knowledge-note/editors`; Workflow Studio from `@powerhousedao/workflow/editors`. Served by the shell over loopback HTTP (`tauri-plugin-localhost` or a small axum static server) so the origin is an ordinary `http://127.0.0.1:<hostPort>`; the same build runs in a normal browser against a running sidecar during development.

### 5.2 Screens

1. **Landing / vault picker** — branded: local vaults (name, note count, last activity, protected badge), remote vaults, *New local vault*, *Connect remote vault* (Switchboard URL + drive id or slug), sign-in state, sidecar state while starting.
2. **Vault** — the unchanged Knowledge Vault drive app full-window, its 10 document editors mounted by document type (as Connect's `useEditorModules` does), plus a slim app bar: back, vault name, protected badge, identity.
3. **Settings** — *Identity* (sign in/out via the system browser, address/DID, credential expiry, renew); *Models* (one OpenAI-compatible endpoint + key, or a local endpoint such as Ollama/LM Studio, shared by chat and pipeline; *local-only mode*); *Vaults* (protect switch, rename, delete, back up/restore, export as documents); *Conversion* (§6); *Workflows* (Workflow Studio); *Diagnostics* (engine status, ports, store sizes, logs, re-index, copy diagnostics, and **Connect your tools**: the `switchboard init --url http://127.0.0.1:<port>/graphql --name local-vault` line and the MCP URL `http://127.0.0.1:<port>/mcp`, with the note that protected mode needs `switchboard auth login --token "$(ph access-token)"`); *About* (app, stack and package versions; an **update notice** that checks the GitHub Releases feed on launch and links to the download — there is no auto-update in v1).

### 5.3 Wiring contract

At boot the host installs the globals the vault app expects, all exported by `reactor-browser`: `setReactorClientModule`/`setReactorClient(new GraphQLReactorClient(origin, bearerProvider))`, `setDocumentCache(remote-first cache)`, `setDrives([...])`, `setSelectedDrive`/`setSelectedNode` driven by the router (`/vault/:driveId/*`), `setPHAppConfig` (including the Switchboard origin override, §7.1), `RenownProvider`. Symbols the app imports and the host must satisfy (from the audit): `setSelectedNode`, `useSelectedDriveId`, `useSelectedDrive`, `useSelectedNode`, `useNodesInSelectedDrive`, `useNodesInSelectedDriveOrFolder`, `useFileNodesInSelectedDrive`, `useDocumentById`, `useDocumentOperations`, `dispatchActions`, `useDrives`, `useSync` (must be a no-op without a sync manager), `useRenownAuth`, `RenownAuthButton`, `ambientRenownTokenProvider`, `usePHToast`, `useTheme`, `useSetPHAppConfig`, `showCreateDocumentModal`, `setAttachmentService`, plus `DocumentToolbar` and the revision-history panel from `@powerhousedao/design-system/connect`. Switching vault = switching the client's origin and bearer; there is never a local reactor or sync manager.

### 5.4 Sign-in

"Sign in" → `POST /auth/login` on the control API → the shell opens the returned Renown URL in the **system browser**, where the user signs with their wallet → the sidecar polls the Renown session, then `renown.login(did)` fetches a delegation credential for the local user keypair → keypair and credential land in `secrets/` → the host learns the identity from `/auth/status`. Bearers for remote vaults come from `/auth/token`. Credential expiry (7 days) is shown in Settings with a one-click renew (same flow). No wallet is ever needed inside the webview.

### 5.5 Remote vaults

A remote vault is a `config.json` entry `{kind:"remote", name, switchboardUrl, driveId}`. Opening it sets the origin override and the bearer provider; drive metadata is read from the remote Switchboard (`GET /d/<id>` and the drive document). Authorisation failure shows "ask the vault's administrator for READ on this drive" with the user's address.

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
- **Links and files.** External links open in the system browser (opener plugin); exports and backups use native save dialogs; the clipboard is allowed for the app's copy actions.
- **Window.** One main window, minimum 960 × 640, state (size, position, maximised) persisted; theme is dark by default (the vault app's own default) with light and system as overrides in Settings — `<html>` carries the `dark` class and `color-scheme: dark` before first paint; close-to-tray configurable (default on) so the engine keeps serving the CLI and agents.
- **Webview parity checks** (Phase 0): WebGL for the PixiJS graph, WASM and WebSocket on WebKitGTK and WKWebView; keyboard focus visible everywhere; `prefers-reduced-motion` respected.

## 6. Document conversion tiers

One setting, the tiers the machine can use, each with Install / Enable / Disable:

| Tier | Converts | Needs | Memory when on |
|---|---|---|---|
| 0 Built-in (always) | pasted text/markdown, `.txt/.md/.html`, text PDFs via `pdfjs-dist` | nothing | ~0 |
| 1 Native converter | everything `docling.rs` handles (PDF incl. scanned/OCR, DOCX, PPTX, XLSX, images) | one-time ~1.4 GB download of the platform binding + ONNX weights into `converter/`; Linux x64/arm64 and Windows x64 today, macOS when upstream publishes a darwin build | ~1.4 GB while enabled |
| 2 Docker converter | same as tier 1 | Docker running; the shell pulls the image with progress and runs `kv-convert` on a loopback port with a named models volume; "Off" = `docker stop`, "Remove" offered; stopped on app exit | ~1.4 GB in the container |
| Remote URL | same | any reachable conversion service | 0 locally |

Tier 0 is a tiny service inside the sidecar implementing the documented conversion contract (`/health`, `/convert`, docling's chunk shape). Enabling a tier sets the vault package's conversion URL at runtime (§7.4); `convert/health` reports *not available on this platform / not installed / installing / starting / ready / down*.

## 7. Changes in the vault package (`bai-knowledge-note`)

1. **Switchboard origin as a runtime setting** (`editors/shared/subgraph-endpoint.ts`): a host-provided origin, set per selected vault through the app config, wins over the hostname heuristics; `resolveReactorEndpoint`, `resolveAuthEndpoint`, `resolveKnowledgeGraphEndpoint` and `editors/shared/remote-reactor.ts` follow it. Heuristics remain the fallback for Connect and the hosted vault.
2. **Host-aware boot** (`editors/knowledge-vault/lib/boot.ts`, `lib/remote-memory.ts`, `hooks/use-remote-first.ts`): skip the Connect-specific work (sync-channel neutralising, remembered-drive re-adding, drive-snapshot hydration) when the host declares itself and no sync manager exists. Independently, cap the Switchboard probe with backoff — the spike recorded 250 requests in 100 s against an unreachable origin, a bug in Connect too.
3. **Open mode**: the `http` subgraph's bearer guard follows the server's auth setting (anonymous allowed when `AUTH_ENABLED=false`, identity recorded as the sidecar's); `AuthGate`, the Access view and signer badges render an "open vault" state instead of sign-in prompts. Protected mode unchanged.
4. **Conversion URL at runtime**: the `convert` subgraph accepts the service URL from a loopback-only setter as well as the environment, and `convert/health` reports the live value and tier state.
5. **Pipeline template**: the working *Vault pipeline (auto)* workflow and its connection exported once as a template with placeholders (drive id, local origin, LLM secret reference) and shipped at `pieces/knowledge-vault/templates/` behind a new `./pieces/knowledge-vault/templates` export, versioned with the piece.
6. **Relied on, unchanged**: `use-drive-init.ts` (folders and singletons on first open, now through the configurable origin); the embedding model and onnxruntime WASM under `dist/node/`; `SWITCHBOARD_APP_NAME` labelling.

## 8. Upstream requests (with interim workarounds)

| To | Request | Interim |
|---|---|---|
| Powerhouse (`reactor-api`/`switchboard`) | a `host` option so the server can bind `127.0.0.1` | one-time acknowledgement for open mode; protected mode unaffected |
| Powerhouse (`switchboard`) | a plain data-dir (NodeFS) storage option instead of `AtomicNodeFs` for local use | the sidecar's loader shim |
| `docling.rs` | a darwin build | tiers 2 and Remote on macOS |

## 9. Error handling and resilience

- **Supervisor.** States *starting → opening store → indexing → ready* on the landing page; port in use → next port, reported to the host; crash on boot → log tail with *Open logs* / *Copy diagnostics* (versions, ports, store sizes, last 200 lines, never secrets); crash at runtime → restart with backoff (3 attempts) and a "Reconnecting…" banner; the vault app's `readBack: unconfirmed` semantics cover writes in flight; a stale `postmaster.pid` is cleared before start when no sidecar runs; the single-instance plugin prevents two windows and two sidecars on one store.
- **Store safety and upgrades.** `config.json` records the stack version that last opened the store. A stack bump first backs up both data dirs to `backups/<date>-<version>/` (free-space check), then starts; a PGlite-major migration runs only after that backup. An app older than the store's version refuses to open it. *Back up / Restore* = quiesce the sidecar, zip the data dirs, reverse to restore; *Export as documents* uses the existing REST export.
- **Remote vaults.** 401 → "your sign-in expired" with renew; 403 → the administrator message with the address; offline → explicit banner (client mode has no cache); a server older than dev.35 (missing the renamed GraphQL arguments) is detected by a probe query and reported.
- **Pipeline and models.** Endpoint/key validated on save (a one-token request); run failures surface as a badge in the Pipeline view linking to the run in Workflow Studio; local-only mode blocks egress and says so.
- **Converter.** Explicit states with the one action that fixes each; downloads are resumable; Docker absence or permission problems are reported with the exact remedy.
- **Data retention.** Uninstalling leaves the app-data directory in place; Settings › Vaults › *Delete all local data* removes it after a typed confirmation.
- **Secrets.** `secrets/` at mode 0600 (OS keychain later), never in webview storage; *Sign out* removes the credential; *Reset identity* deletes the user keypair with a warning about attribution continuity.

## 10. Testing

- **Rust:** app-data paths, config read/migrate, port selection, supervisor state machine, Docker detection parsing.
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
- **Upstream `host` option.** Until it lands, open mode exposes the port on the LAN behind a one-time acknowledgement.
- **Installer size.** Dominated by `node_modules`; measured and trimmed in Phase 6.

## 14. Phases (input to the implementation plan)

0. Repo scaffold; sidecar boots on a plain data dir with the control API skeleton; host skeleton serves the vault app against the sidecar — requires package changes §7.1–7.2 first (in `bai-knowledge-note`, linked locally).
1. Vault creation and first run; landing; identity via the system-browser flow; protection switch (§7.3).
2. Pipeline: template export (§7.5), instantiation, Models settings, Workflow Studio mount.
3. Remote vaults.
4. Conversion tiers: built-in and remote URL (§7.4); then native and Docker.
5. Resilience: supervisor, backups, upgrade guard, diagnostics, tray.
6. Packaging, CI, e2e and performance gates; macOS builds.
