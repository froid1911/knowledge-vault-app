# Desktop Knowledge Vault — Phase 1 "Vaults and identity" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The designed landing (spec §5.7) with vault tiles and first-run creation; Renown sign-in through the sidecar and the system browser; the **Protect local vaults** switch (sidecar restart into protected mode, user identity as the engine's signer); Settings with Identity, Vaults, Diagnostics and About.

**Architecture:** Identity lives in the sidecar (`@renown/sdk/node`: keypair + credential under `secrets/`), exposed through the control API (`/auth/*`); the host never holds a key. Protection is a sidecar-wide mode: the host asks the shell, the shell rewrites `config.json`, stops the sidecar and respawns it with `KV_PROTECTED=1` and the admin address; the sidecar then starts the Switchboard with the user's keypair as its identity. The landing reads vault metadata from the graph index and draws each vault's constellation from a sample of its own edges with a tiny deterministic force layout.

**Tech Stack:** as Phase 0, plus `@renown/sdk` 6.2.3-dev.44 (sidecar), Tauri commands for config and restart, `@testing-library/react` + jsdom for host component tests.

**Spec:** `docs/superpowers/specs/2026-10-06-desktop-knowledge-vault-design.md` — §4.4 (identity and the protection switch), §4.6 (control API `/auth/*`), §5.2 (screens), §5.4 (sign-in), §5.6 (config file), §5.7 (landing design), §7.3 (open mode in the package), §9 (401 → renew). **Prerequisite:** Plan 0 complete (`2026-10-06-phase0-foundation.md`).

## Global Constraints

- Everything in Plan 0's Global Constraints (stack pin `6.2.3-dev.44`, bun locally, `.js` imports in the vault package, ports 4200/4201/4202, no `.env`, vocabulary, commit trailer).
- Copy is exactly the spec's: "New vault", "Create vault", toast "Vault created", "Sign in", "Protected — sign in to open", "Protect local vaults — requires sign-in", status strip sentence "Everything stays on this computer unless you connect a remote vault, a model provider or a converter.", tile metadata as a sentence ("2,165 notes, opened 2 days ago"). No all-caps labels, no middle-dot meta strings, no "→" appended to buttons.
- Design tokens (§5.7): only the vault app's `var(--bai-*)` tokens, dark by default — `--bai-bg`, `--bai-surface`, `--bai-deep`, `--bai-hover`, `--bai-border`, `--bai-text` with `-secondary/-tertiary/-muted/-faint`, `--bai-accent` (+ `-soft`, `-hover`, `-text`), `--bai-status-draft` (the app's amber: protected lock only), `--bai-status-canonical` (ready green), `--bai-danger`. The host root carries `data-bai-theme` from `useTheme()` and `App` calls `initTheme()` once (both from Plan 0's theme follow-up), so the tokens resolve for the shell exactly as inside the app; no hex colour is written in `host/`. Inter for UI, Source Serif 4 for vault names only; focus ring 2 px `--bai-accent`; `prefers-reduced-motion` disables the settle animation.
- Secrets (`user.keypair.json`, `renown.json`) are written with mode 0600 under `secrets/`; the control API never returns a key or credential, only status.
- Protected mode requires a signed-in user; the switch is disabled otherwise. The switch applies to all local vaults (process-wide flags) and the UI says so.

## Review Focus

1. **Sign-in started twice** (double click, or a second window): there must be one in-flight login; the second request returns the same URL — Task 2 `identity.test.ts` "second startLogin returns the pending URL".
2. **Expired credential** (7 days): `/auth/status` says `expired: true`, `/auth/token` refuses with "Your sign-in expired. Sign in again.", Identity settings shows **Renew** — Task 2 test with a credential whose `expirationDate` is in the past.
3. **Protect while signed out**: the control API answers 409 "Sign in first", the switch is disabled with that sentence — Task 3 control test, Task 5 Vaults-settings test.
4. **Vault names that are blank or absurdly long**: trimmed, 1–80 characters, the form says why otherwise — Task 4 `vault-name.test.ts`.
5. **Ports change across a protection restart**: the host must re-read `sidecar_info` after `sidecar:status` reports `ready` and never reuse the old port — Task 4 `use-sidecar.test.ts` with a mocked `listen`.

---

## Part A — vault package (`bai-knowledge-note`, branch `feat/desktop-host-mode`)

### Task 1: Open mode — the REST guard follows the server's auth setting; host hint for the UI

**Files:**
- Modify: `editors/shared/host-config.ts` (add `auth?: "open" | "protected"`), `subgraphs/http/lib/authorize.ts` (`requireUser`), `editors/knowledge-vault/components/access/AccessView.tsx` (open-vault notice)
- Create: `editors/knowledge-vault/components/access/OpenVaultNotice.tsx`, `subgraphs/http/lib/authorize.test.ts`
- Test: `editors/shared/host-config.test.ts` (extend)

**Interfaces:**
- Produces: `KnowledgeVaultHostConfig.auth?: "open" | "protected"`; `authDisabled(env?: NodeJS.ProcessEnv): boolean`; `OPEN_VAULT_ADDRESS = "0x0000000000000000000000000000000000000000"`; `requireUser(ctx)` returns `{ address: OPEN_VAULT_ADDRESS }` when `authDisabled()` and `ctx.user` is absent; `shouldShowOpenVaultNotice(): boolean`.

- [ ] **Step 1: Failing tests**

```ts
// subgraphs/http/lib/authorize.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { authDisabled, OPEN_VAULT_ADDRESS, requireUser } from "./authorize.js";
import type { RouteContext } from "@powerhousedao/shared/processors";

const ctx = (user: unknown): RouteContext => ({ user, params: {} }) as unknown as RouteContext;
afterEach(() => { delete process.env.AUTH_ENABLED; });

describe("requireUser in open mode", () => {
  it("still requires a bearer when authorization is on", () => {
    process.env.AUTH_ENABLED = "true";
    expect(authDisabled()).toBe(false);
    expect(() => requireUser(ctx(undefined))).toThrow(/verified bearer/);
  });
  it("admits an anonymous caller as the open-vault address when authorization is off", () => {
    process.env.AUTH_ENABLED = "false";
    expect(authDisabled()).toBe(true);
    expect(requireUser(ctx(undefined))).toEqual({ address: OPEN_VAULT_ADDRESS });
  });
  it("prefers a real user even when authorization is off", () => {
    process.env.AUTH_ENABLED = "false";
    expect(requireUser(ctx({ address: "0xabc" }))).toEqual({ address: "0xabc" });
  });
});
```
Append to `editors/shared/host-config.test.ts`:
```ts
  it("carries the auth hint and defaults it to undefined", () => {
    setHostConfig({ kind: "desktop", switchboardOrigin: "http://127.0.0.1:4201", auth: "open" });
    expect(getHostConfig()?.auth).toBe("open");
  });
```

- [ ] **Step 2: Run** `bun run vitest run subgraphs/http/lib/authorize.test.ts editors/shared/host-config.test.ts` → FAIL (`authDisabled` undefined; `auth` not a known key).

- [ ] **Step 3: Implement**

`editors/shared/host-config.ts`: add to the type `auth?: "open" | "protected";` and copy it in `setHostConfig` (`g[SLOT] = { kind, switchboardOrigin, ...(config.auth ? { auth: config.auth } : {}) }`).

`subgraphs/http/lib/authorize.ts`:
```ts
/** The Switchboard's own switch (`.env`/sidecar env); the REST surface follows it. */
export function authDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AUTH_ENABLED === "false";
}
/** The caller every anonymous request is attributed to while authorization is off. */
export const OPEN_VAULT_ADDRESS = "0x0000000000000000000000000000000000000000";

export function requireUser(ctx: RouteContext): NonNullable<RouteContext["user"]> {
  if (ctx.user) return ctx.user;
  if (authDisabled()) return { address: OPEN_VAULT_ADDRESS } as NonNullable<RouteContext["user"]>;
  throw new HttpError(401, "UNAUTHENTICATED", "A verified bearer is required");
}
```

`editors/knowledge-vault/components/access/OpenVaultNotice.tsx`:
```tsx
import { getHostConfig } from "../../../shared/host-config.js";
export const OPEN_VAULT_NOTICE =
  "This vault is open. Anyone who can reach this computer can read and change it. Turn on Protect local vaults in Settings to require sign-in.";
export function shouldShowOpenVaultNotice(): boolean {
  return getHostConfig()?.auth === "open";
}
export function OpenVaultNotice() {
  return (
    <section role="status" className="rounded-md border p-4 text-sm" style={{ borderColor: "var(--bai-border)" }}>
      <h2 className="mb-1 font-semibold">Open vault</h2>
      <p>{OPEN_VAULT_NOTICE}</p>
    </section>
  );
}
```
In `AccessView.tsx`, at the top of the component's render: `if (shouldShowOpenVaultNotice()) return <OpenVaultNotice />;` (import from `./OpenVaultNotice.js`).

- [ ] **Step 4: Run** the two test files → PASS. Then `bun run tsc && bun run lint:fix && bun run test && bun run build`.

- [ ] **Step 5: Commit**
```bash
git add editors/shared/host-config.ts editors/shared/host-config.test.ts subgraphs/http/lib/authorize.ts subgraphs/http/lib/authorize.test.ts editors/knowledge-vault/components/access/OpenVaultNotice.tsx editors/knowledge-vault/components/access/AccessView.tsx
git commit -m "feat(open-mode): REST guard follows AUTH_ENABLED; Access view explains an open vault

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Part B — desktop repository (branch `dev`)

### Task 2: Sidecar identity — Renown session flow and tokens

**Files:**
- Create: `sidecar/src/identity.ts`, `sidecar/src/identity.test.ts`
- Modify: `sidecar/src/control.ts` (routes `/auth/*`), `sidecar/src/control.test.ts`, `sidecar/src/main.ts` (wire identity; protected `identity` option), `sidecar/package.json` (add `"@renown/sdk": "6.2.3-dev.44"`)

**Interfaces:**
- Produces: `createIdentity(deps: IdentityDeps): Identity` with
  `type IdentityStatus = { authenticated: boolean; address?: string; did?: string; credentialExpiresAt?: string; expired: boolean; pending: boolean; loginUrl?: string }`,
  `Identity.status(): IdentityStatus`, `Identity.startLogin(): Promise<{ url: string; sessionId: string }>`, `Identity.logout(): Promise<void>`, `Identity.token(aud?: string): Promise<string>`.
  Control routes: `GET /auth/status` → `IdentityStatus`; `POST /auth/login` → `200 { url, sessionId }`; `POST /auth/logout` → `204`; `GET /auth/token?aud=` → `{ token, expiresIn }` or `409 { error: "Your sign-in expired. Sign in again." }` / `401 { error: "Not signed in." }`.
  Files: `secrets/user.keypair.json`, `secrets/renown.json`.

- [ ] **Step 1: Failing tests**

```ts
// sidecar/src/identity.test.ts
import { describe, expect, it, vi } from "vitest";
import { createIdentity, type IdentityDeps } from "./identity.js";

function fakeDeps(over: Partial<IdentityDeps> = {}): IdentityDeps & { renown: { user?: unknown } } {
  const renown: { user?: { address: string; did: string; credential?: { expirationDate?: string } }; logout: () => Promise<void> } = { logout: vi.fn(async () => { renown.user = undefined; }) };
  return {
    renown: renown as never,
    renownUrl: "https://www.renown.id",
    browserLogin: vi.fn(async (_r, opts) => {
      opts.onLoginUrl?.("https://www.renown.id/console?session=s1", "s1");
      await new Promise((r) => setTimeout(r, 20));
      renown.user = { address: "0xabc", did: "did:pkh:eip155:1:0xabc", credential: { expirationDate: new Date(Date.now() + 86_400_000).toISOString() } };
      return { user: renown.user, cliDid: "did:key:z6M" };
    }),
    generateAccessToken: vi.fn(async () => ({ token: "jwt", did: "did:key:z6M", address: "0xabc", expiresIn: 600 })),
    ...over,
  } as never;
}

describe("identity", () => {
  it("reports signed out, then pending with the login url, then authenticated", async () => {
    const id = createIdentity(fakeDeps());
    expect(id.status()).toMatchObject({ authenticated: false, pending: false, expired: false });
    const started = await id.startLogin();
    expect(started).toEqual({ url: "https://www.renown.id/console?session=s1", sessionId: "s1" });
    expect(id.status()).toMatchObject({ pending: true, loginUrl: started.url });
    await new Promise((r) => setTimeout(r, 40));
    expect(id.status()).toMatchObject({ authenticated: true, address: "0xabc", pending: false, expired: false });
  });
  it("returns the pending login url instead of starting a second flow", async () => {
    const deps = fakeDeps();
    const id = createIdentity(deps);
    const a = await id.startLogin();
    const b = await id.startLogin();
    expect(b).toEqual(a);
    expect(deps.browserLogin).toHaveBeenCalledTimes(1);
  });
  it("flags an expired credential and refuses to mint a token", async () => {
    const deps = fakeDeps();
    deps.renown.user = { address: "0xabc", did: "did:pkh:eip155:1:0xabc", credential: { expirationDate: new Date(Date.now() - 1000).toISOString() } };
    const id = createIdentity(deps);
    expect(id.status()).toMatchObject({ authenticated: true, expired: true });
    await expect(id.token()).rejects.toThrow("Your sign-in expired. Sign in again.");
  });
  it("mints a token with the audience and signs out", async () => {
    const deps = fakeDeps();
    deps.renown.user = { address: "0xabc", did: "d", credential: { expirationDate: new Date(Date.now() + 1000_000).toISOString() } };
    const id = createIdentity(deps);
    await expect(id.token("https://switchboard.example")).resolves.toBe("jwt");
    expect(deps.generateAccessToken).toHaveBeenCalledWith(deps.renown, { expiresIn: 600, aud: "https://switchboard.example" });
    await id.logout();
    expect(id.status().authenticated).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `bun run vitest run sidecar/src/identity.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `identity.ts`**

```ts
// sidecar/src/identity.ts
import { browserLogin as sdkBrowserLogin, generateAccessToken as sdkGenerateAccessToken, RenownBuilder } from "@renown/sdk/node";
import type { BrowserLoginOptions, BrowserLoginResult } from "@renown/sdk/node";
import type { IRenown } from "@renown/sdk";
import { join } from "node:path";

export type IdentityStatus = {
  authenticated: boolean;
  address?: string;
  did?: string;
  credentialExpiresAt?: string;
  expired: boolean;
  pending: boolean;
  loginUrl?: string;
};
export type IdentityDeps = {
  renown: IRenown;
  renownUrl: string;
  browserLogin: (renown: IRenown, options: BrowserLoginOptions) => Promise<BrowserLoginResult>;
  generateAccessToken: (renown: IRenown, options: { expiresIn: number; aud?: string }) => Promise<{ token: string; expiresIn: number }>;
};
export type Identity = {
  status(): IdentityStatus;
  startLogin(): Promise<{ url: string; sessionId: string }>;
  logout(): Promise<void>;
  token(aud?: string): Promise<string>;
};
const TOKEN_TTL_S = 600;
export const EXPIRED_MESSAGE = "Your sign-in expired. Sign in again.";
export const NOT_SIGNED_IN_MESSAGE = "Not signed in.";

/** Build the SDK instance over the app's secrets dir (keypair + credential cache, both 0600 by the SDK). */
export async function buildRenown(secretsDir: string, renownUrl: string, switchboardUrl: string): Promise<IRenown> {
  return new RenownBuilder("desktop-knowledge-vault", {
    keyPath: join(secretsDir, "user.keypair.json"),
    storagePath: join(secretsDir, "renown.json"),
    baseUrl: renownUrl,
    switchboardUrl,
  }).build();
}
export const sdkDeps = { browserLogin: sdkBrowserLogin, generateAccessToken: sdkGenerateAccessToken };

export function createIdentity(deps: IdentityDeps): Identity {
  let pending: { url: string; sessionId: string; done: Promise<void> } | undefined;
  const user = () => (deps.renown as unknown as { user?: { address: string; did: string; credential?: { expirationDate?: string } } }).user;
  const isExpired = () => {
    const exp = user()?.credential?.expirationDate;
    return !!exp && Date.parse(exp) <= Date.now();
  };
  return {
    status() {
      const u = user();
      return {
        authenticated: !!u?.credential,
        address: u?.address,
        did: u?.did,
        credentialExpiresAt: u?.credential?.expirationDate,
        expired: isExpired(),
        pending: !!pending,
        loginUrl: pending?.url,
      };
    },
    async startLogin() {
      if (pending) return { url: pending.url, sessionId: pending.sessionId };
      if (user()?.credential && !isExpired()) throw new Error(`Already signed in as ${user()!.address}.`);
      if (user()?.credential) await (deps.renown as unknown as { logout(): Promise<void> }).logout();
      let resolveUrl!: (v: { url: string; sessionId: string }) => void;
      const urlPromise = new Promise<{ url: string; sessionId: string }>((r) => (resolveUrl = r));
      const done = deps
        .browserLogin(deps.renown, {
          renownUrl: deps.renownUrl,
          timeoutMs: 10 * 60_000,
          onLoginUrl: (url, sessionId) => resolveUrl({ url, sessionId }),
        })
        .then(() => undefined)
        .catch((error: unknown) => { console.error(`[identity] sign-in failed: ${error instanceof Error ? error.message : String(error)}`); })
        .finally(() => { pending = undefined; });
      const started = await urlPromise;
      pending = { ...started, done };
      return started;
    },
    async logout() {
      await (deps.renown as unknown as { logout(): Promise<void> }).logout();
    },
    async token(aud) {
      if (!user()?.credential) throw new Error(NOT_SIGNED_IN_MESSAGE);
      if (isExpired()) throw new Error(EXPIRED_MESSAGE);
      const { token } = await deps.generateAccessToken(deps.renown, { expiresIn: TOKEN_TTL_S, ...(aud ? { aud } : {}) });
      return token;
    },
  };
}
```

- [ ] **Step 4: Control routes + wiring**

Extend `ControlDeps` in `control.ts` with `identity: Identity` and add, inside the try block:
```ts
      if (req.method === "GET" && url.pathname === "/auth/status") return send(res, 200, deps.identity.status(), allowed);
      if (req.method === "POST" && url.pathname === "/auth/login") return send(res, 200, await deps.identity.startLogin(), allowed);
      if (req.method === "POST" && url.pathname === "/auth/logout") { await deps.identity.logout(); res.statusCode = 204; if (allowed) res.setHeader("access-control-allow-origin", allowed); res.end(); return; }
      if (req.method === "GET" && url.pathname === "/auth/token") {
        try {
          const token = await deps.identity.token(url.searchParams.get("aud") ?? undefined);
          return send(res, 200, { token, expiresIn: 600 }, allowed);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return send(res, message === "Not signed in." ? 401 : 409, { error: message }, allowed);
        }
      }
```
Control tests (append): `/auth/status` returns the fake identity's status; `/auth/token` → 401 when signed out; → 409 with the expiry sentence when expired (fake identity throwing `EXPIRED_MESSAGE`).

`main.ts`: after `switchboardEnv`, before starting the Switchboard:
```ts
  const renownUrl = process.env.KV_RENOWN_URL || "https://www.renown.id";
  const renown = await buildRenown(join(cfg.dataDir, "secrets"), renownUrl, `http://127.0.0.1:${cfg.port}/graphql`);
  const identity = createIdentity({ renown, renownUrl, ...sdkDeps });
```
and in `startSwitchboard` options: `identity: cfg.protected ? { keypairPath: join(cfg.dataDir, "secrets", "user.keypair.json"), requireExisting: true, baseUrl: renownUrl } : undefined,` — the Switchboard's `initRenown` loads that keypair as the engine's signer (spec §4.4). Pass `identity` into `createControlServer`.

- [ ] **Step 5: Run** `bun run vitest run sidecar/src` → PASS; `bun run --cwd sidecar tsc`; then by hand: `bun run dev:sidecar`, `curl -X POST -H 'authorization: Bearer dev-token' http://127.0.0.1:4202/auth/login` → a `https://www.renown.id/console?session=…` URL (and the system browser opens it); complete sign-in with your wallet; `GET /auth/status` → `authenticated: true`, your address; `ls -la .dev-data/secrets/` shows `user.keypair.json renown.json workflows.key` all `-rw-------`.

- [ ] **Step 6: Commit**
```bash
git add sidecar
git commit -m "feat(sidecar): Renown sign-in through the system browser, status and tokens on the control API

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 3: The protection switch — config, restart, protected engine

**Files:**
- Modify: `src-tauri/src/config.rs` (AppConfig read/write), `src-tauri/src/sidecar.rs` (`restart_sidecar`), `src-tauri/src/lib.rs` (commands `config_read`, `config_write`, `set_local_protection`), `sidecar/src/control.ts` (`GET /local/protection`), `src-tauri/Cargo.toml` (add `dirs = "6"` is **not** needed — `app.path()` suffices)
- Test: Rust tests in `config.rs`; control test

**Interfaces:**
- Produces: `AppConfig { version: 1, stack_version: String, local: LocalConfig { protected: bool, admin_address: Option<String> }, ui: UiConfig { close_to_tray: bool, theme: String } }` (serde camelCase), `AppConfig::load(path) -> AppConfig` (defaults when missing), `AppConfig::save(&self, path)`; Tauri commands `config_read() -> AppConfig`, `config_write(config: AppConfig)`, `set_local_protection(protected: bool, admin_address: Option<String>) -> Result<(), String>` (saves, restarts the sidecar with the new env, emits `sidecar:status`); the sidecar's `GET /local/protection` → `{ protected, adminAddress }` (from its env).

- [ ] **Step 1: Rust tests** (in `config.rs`)
```rust
    #[test]
    fn config_round_trips_and_defaults_when_missing() {
        let dir = std::env::temp_dir().join(format!("kv-cfg-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        let loaded = AppConfig::load(&path);
        assert_eq!(loaded.version, 1);
        assert!(!loaded.local.protected);
        let mut c = loaded;
        c.local.protected = true;
        c.local.admin_address = Some("0xabc".into());
        c.save(&path).unwrap();
        let again = AppConfig::load(&path);
        assert!(again.local.protected);
        assert_eq!(again.local.admin_address.as_deref(), Some("0xabc"));
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("\"adminAddress\"")); // camelCase on disk, as the spec's §5.6 shows
    }
```
- [ ] **Step 2: Implement**
```rust
// src-tauri/src/config.rs (additions)
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LocalConfig { pub protected: bool, pub admin_address: Option<String> }
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UiConfig { pub close_to_tray: bool, pub theme: String }
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig { pub version: u32, pub stack_version: String, pub local: LocalConfig, pub ui: UiConfig }

pub const STACK_VERSION: &str = "6.2.3-dev.44";
impl Default for AppConfig {
    fn default() -> Self {
        Self { version: 1, stack_version: STACK_VERSION.into(), local: LocalConfig { protected: false, admin_address: None }, ui: UiConfig { close_to_tray: true, theme: "dark".into() } }
    }
}
impl AppConfig {
    pub fn load(path: &Path) -> AppConfig {
        std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    }
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() { std::fs::create_dir_all(parent)?; }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(self).expect("config serialises"))?;
        std::fs::rename(tmp, path)
    }
}
```
`SidecarEnv::build` gains `protected: bool, admin_address: Option<&str>` → pushes `KV_PROTECTED=1` and `KV_ADMIN_ADDRESS` when protected (update its test: protected case includes both). `spawn_sidecar` takes the `AppConfig` to derive them. Add `pub fn restart_sidecar(app, paths, ports, token, version, config)` = `stop_sidecar` + `spawn_sidecar`. Store `AppPaths`, `Ports`, token and the config path in a `tauri::State<Mutex<ShellState>>` so commands can reach them.

Commands in `lib.rs`:
```rust
#[tauri::command]
fn config_read(state: tauri::State<'_, Mutex<ShellState>>) -> AppConfig { AppConfig::load(&state.lock().unwrap().config_path) }
#[tauri::command]
fn config_write(state: tauri::State<'_, Mutex<ShellState>>, config: AppConfig) -> Result<(), String> { config.save(&state.lock().unwrap().config_path).map_err(|e| e.to_string()) }
#[tauri::command]
fn set_local_protection(app: tauri::AppHandle, state: tauri::State<'_, Mutex<ShellState>>, protected: bool, admin_address: Option<String>) -> Result<(), String> {
    if protected && admin_address.is_none() { return Err("Sign in first".into()); }
    let (path, paths, ports, token, version) = { let s = state.lock().unwrap(); (s.config_path.clone(), s.paths.clone(), s.ports, s.token.clone(), s.version.clone()) };
    let mut cfg = AppConfig::load(&path);
    cfg.local.protected = protected;
    cfg.local.admin_address = if protected { admin_address } else { cfg.local.admin_address };
    cfg.save(&path).map_err(|e| e.to_string())?;
    restart_sidecar(&app, &paths, ports, token, &version, &cfg).map_err(|e| e.to_string())
}
```
(`AppPaths` derives `Clone`.) Sidecar `GET /local/protection` → `{ protected: cfg.protected, adminAddress: cfg.adminAddress ?? null }`.

- [ ] **Step 3: Run** `cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test` → PASS. By hand under `bun run dev`: toggling (Task 5 UI) restarts the engine; `.dev-data/…` unaffected; `curl …/status` shows `protected: true`; an anonymous `POST /graphql { __typename }` to 4201 now answers 401.

- [ ] **Step 4: Commit**
```bash
git add src-tauri sidecar/src/control.ts sidecar/src/control.test.ts
git commit -m "feat(shell): config.json, protection switch with a sidecar restart into protected mode

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 4: Host plumbing — sidecar status hook, identity hook, config store, constellation layout

**Files:**
- Create: `host/src/state/use-sidecar.ts`, `host/src/state/use-identity.ts`, `host/src/state/config-store.ts`, `host/src/state/recents.ts`, `host/src/landing/constellation.ts`, `host/src/landing/vault-name.ts`, `host/src/api/graph.ts`
- Test: `host/src/state/use-sidecar.test.ts`, `host/src/landing/constellation.test.ts`, `host/src/landing/vault-name.test.ts`, `host/src/api/graph.test.ts`

**Interfaces:**
- Produces: `useSidecar(): { info: SidecarInfo | null; state: "starting" | "ready" | "exited" }` (Tauri: `listen("sidecar:status")` + `invoke("sidecar_info")`; browser: resolves once); `useIdentity(info): { status: IdentityStatus | null; signIn(): Promise<void>; signOut(): Promise<void>; refresh(): void }`; `ConfigStore { read(): Promise<HostConfig>; write(c: HostConfig): Promise<void> }` with `createConfigStore(): ConfigStore` (Tauri commands or localStorage `kv.config`); `rememberOpened(store, vaultId, when)`, `lastOpened(config, vaultId): string | undefined`; `validateVaultName(raw: string): { ok: true; name: string } | { ok: false; reason: string }`; `layoutConstellation(nodeIds: string[], edges: Array<[string, string]>, seed: string, width: number, height: number): Array<{ id: string; x: number; y: number }>`; `fetchVaultGraph(graphqlUrl, driveId, fetchImpl): Promise<{ noteCount: number; nodeIds: string[]; edges: Array<[string, string]> }>` (sample ≤ 48 nodes, ≤ 120 edges).

- [ ] **Step 1: Failing tests**
```ts
// host/src/landing/vault-name.test.ts
import { describe, expect, it } from "vitest";
import { validateVaultName } from "./vault-name.js";
describe("validateVaultName", () => {
  it("trims and accepts 1–80 characters", () => {
    expect(validateVaultName("  Research notes ")).toEqual({ ok: true, name: "Research notes" });
  });
  it("rejects blank and over-long names with a reason", () => {
    expect(validateVaultName("   ")).toEqual({ ok: false, reason: "A vault needs a name." });
    expect(validateVaultName("x".repeat(81))).toEqual({ ok: false, reason: "Keep the name under 80 characters." });
  });
});
```
```ts
// host/src/landing/constellation.test.ts
import { describe, expect, it } from "vitest";
import { layoutConstellation } from "./constellation.js";
const ids = Array.from({ length: 12 }, (_, i) => `n${i}`);
const edges: Array<[string, string]> = ids.slice(1).map((id, i) => [ids[i]!, id]);
describe("layoutConstellation", () => {
  it("is deterministic for the same seed and keeps every node inside the box", () => {
    const a = layoutConstellation(ids, edges, "vault-1", 320, 160);
    const b = layoutConstellation(ids, edges, "vault-1", 320, 160);
    expect(a).toEqual(b);
    for (const p of a) { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(320); expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(160); }
  });
  it("differs for another seed and handles an empty vault", () => {
    expect(layoutConstellation(ids, edges, "vault-2", 320, 160)).not.toEqual(layoutConstellation(ids, edges, "vault-1", 320, 160));
    expect(layoutConstellation([], [], "empty", 320, 160)).toEqual([]);
  });
});
```
```ts
// host/src/api/graph.test.ts
import { describe, expect, it, vi } from "vitest";
import { fetchVaultGraph } from "./graph.js";
describe("fetchVaultGraph", () => {
  it("reads the note count and a bounded sample of nodes and edges", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ data: {
      knowledgeGraphStats: { noteCount: 2165 },
      knowledgeGraphEdges: Array.from({ length: 300 }, (_, i) => ({ sourceDocumentId: `a${i % 60}`, targetDocumentId: `a${(i * 7) % 60}` })),
    } }) })) as unknown as typeof fetch;
    const g = await fetchVaultGraph("http://127.0.0.1:4201/graphql", "d1", fetchImpl);
    expect(g.noteCount).toBe(2165);
    expect(g.nodeIds.length).toBeLessThanOrEqual(48);
    expect(g.edges.length).toBeLessThanOrEqual(120);
    for (const [s, t] of g.edges) { expect(g.nodeIds).toContain(s); expect(g.nodeIds).toContain(t); }
  });
});
```
```ts
// host/src/state/use-sidecar.test.ts
// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
const listeners: Array<(e: { payload: { state: string } }) => void> = [];
const infos = [null, { port: 4305, controlPort: 4306, controlToken: "t" }];
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (_n: string, cb: (e: { payload: { state: string } }) => void) => { listeners.push(cb); return () => {}; }) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => infos.shift() ?? { port: 4305, controlPort: 4306, controlToken: "t" }) }));
import { useSidecar } from "./use-sidecar.js";
describe("useSidecar (Tauri)", () => {
  it("re-reads sidecar_info when the shell reports ready, using the new port", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    const { result } = renderHook(() => useSidecar());
    await waitFor(() => expect(result.current.state).toBe("starting"));
    act(() => listeners.forEach((cb) => cb({ payload: { state: "ready" } })));
    await waitFor(() => expect(result.current.info?.origin).toBe("http://127.0.0.1:4305"));
    expect(result.current.state).toBe("ready");
  });
});
```

- [ ] **Step 2: Run** `bun run vitest run host/src` → FAIL (modules missing).

- [ ] **Step 3: Implement**

```ts
// host/src/landing/vault-name.ts
export const VAULT_NAME_MAX = 80;
export function validateVaultName(raw: string): { ok: true; name: string } | { ok: false; reason: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, reason: "A vault needs a name." };
  if (name.length > VAULT_NAME_MAX) return { ok: false, reason: `Keep the name under ${VAULT_NAME_MAX} characters.` };
  return { ok: true, name };
}
```
```ts
// host/src/landing/constellation.ts — a small deterministic force layout for the tiles
function prng(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}
export function layoutConstellation(nodeIds: string[], edges: Array<[string, string]>, seed: string, width: number, height: number) {
  if (nodeIds.length === 0) return [];
  const rand = prng(seed);
  const pos = new Map(nodeIds.map((id) => [id, { x: rand() * width, y: rand() * height, vx: 0, vy: 0 }]));
  const index = new Map(nodeIds.map((id, i) => [id, i]));
  const links = edges.filter(([s, t]) => index.has(s) && index.has(t) && s !== t);
  const k = Math.sqrt((width * height) / nodeIds.length);
  for (let iter = 0; iter < 80; iter++) {
    const cool = 1 - iter / 80;
    for (const a of nodeIds) for (const b of nodeIds) {
      if (a >= b) continue;
      const pa = pos.get(a)!, pb = pos.get(b)!;
      let dx = pa.x - pb.x, dy = pa.y - pb.y; const d = Math.max(1, Math.hypot(dx, dy));
      const f = (k * k) / d; dx /= d; dy /= d;
      pa.vx += dx * f; pa.vy += dy * f; pb.vx -= dx * f; pb.vy -= dy * f;
    }
    for (const [s, t] of links) {
      const ps = pos.get(s)!, pt = pos.get(t)!;
      let dx = pt.x - ps.x, dy = pt.y - ps.y; const d = Math.max(1, Math.hypot(dx, dy));
      const f = (d * d) / k; dx /= d; dy /= d;
      ps.vx += dx * f; ps.vy += dy * f; pt.vx -= dx * f; pt.vy -= dy * f;
    }
    for (const p of pos.values()) {
      const v = Math.hypot(p.vx, p.vy) || 1; const step = Math.min(v, 6 * cool);
      p.x = Math.min(width, Math.max(0, p.x + (p.vx / v) * step));
      p.y = Math.min(height, Math.max(0, p.y + (p.vy / v) * step));
      p.vx = 0; p.vy = 0;
    }
  }
  return nodeIds.map((id) => ({ id, x: Math.round(pos.get(id)!.x * 10) / 10, y: Math.round(pos.get(id)!.y * 10) / 10 }));
}
```
```ts
// host/src/api/graph.ts
export type VaultGraph = { noteCount: number; nodeIds: string[]; edges: Array<[string, string]> };
export async function fetchVaultGraph(graphqlUrl: string, driveId: string, fetchImpl: typeof fetch = fetch, token?: string): Promise<VaultGraph> {
  const res = await fetchImpl(graphqlUrl, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query: `query G($d: String!) { knowledgeGraphStats(driveId: $d) { noteCount } knowledgeGraphEdges(driveId: $d) { sourceDocumentId targetDocumentId } }`, variables: { d: driveId } }),
  });
  const json = (await res.json()) as { data?: { knowledgeGraphStats?: { noteCount: number }; knowledgeGraphEdges?: Array<{ sourceDocumentId: string; targetDocumentId: string }> } };
  const all = json.data?.knowledgeGraphEdges ?? [];
  const degree = new Map<string, number>();
  for (const e of all) { degree.set(e.sourceDocumentId, (degree.get(e.sourceDocumentId) ?? 0) + 1); degree.set(e.targetDocumentId, (degree.get(e.targetDocumentId) ?? 0) + 1); }
  const nodeIds = [...degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 48).map(([id]) => id);
  const keep = new Set(nodeIds);
  const edges = all.filter((e) => keep.has(e.sourceDocumentId) && keep.has(e.targetDocumentId)).slice(0, 120).map((e) => [e.sourceDocumentId, e.targetDocumentId] as [string, string]);
  return { noteCount: json.data?.knowledgeGraphStats?.noteCount ?? 0, nodeIds, edges };
}
```
```ts
// host/src/state/use-sidecar.ts
import { useEffect, useState } from "react";
import { resolveSidecar, sidecarOrigins, type SidecarInfo } from "../sidecar.js";
export type SidecarState = "starting" | "ready" | "exited";
const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export function useSidecar(): { info: SidecarInfo | null; state: SidecarState } {
  const [info, setInfo] = useState<SidecarInfo | null>(null);
  const [state, setState] = useState<SidecarState>("starting");
  useEffect(() => {
    let alive = true;
    const read = async () => {
      if (!inTauri()) { const i = await resolveSidecar(); if (alive) { setInfo(i); setState("ready"); } return; }
      const { invoke } = await import("@tauri-apps/api/core");
      const r = await invoke<{ port: number; controlPort: number; controlToken: string } | null>("sidecar_info");
      if (!alive) return;
      if (r) { setInfo({ ...sidecarOrigins(r.port, r.controlPort), controlToken: r.controlToken }); setState("ready"); }
    };
    void read();
    let unlisten: (() => void) | undefined;
    if (inTauri()) {
      void import("@tauri-apps/api/event").then(({ listen }) =>
        listen<{ state: SidecarState }>("sidecar:status", (e) => {
          setState(e.payload.state);
          if (e.payload.state === "ready") void read();
          if (e.payload.state === "exited") setInfo(null);
        }).then((u) => { unlisten = u; }),
      );
    }
    return () => { alive = false; unlisten?.(); };
  }, []);
  return { info, state };
}
```
`use-identity.ts` polls `GET /auth/status` every 1.5 s while `pending`, exposes `signIn()` (POST `/auth/login`, then `window.open(url)` is **not** called — the sidecar opened the system browser; the UI shows "Finish signing in in your browser" with the URL as a copyable fallback), `signOut()`. `config-store.ts`: Tauri → `invoke("config_read")`/`invoke("config_write", { config })`; browser → `localStorage["kv.config"]` with the same `HostConfig` type (`{ version, stackVersion, local: { protected, adminAddress }, ui, recents: Record<string, string> }` — `recents` is host-only and stored in `ui`-adjacent `recents` key; the Rust struct gains `#[serde(default)] pub recents: BTreeMap<String, String>`). `recents.ts`: `rememberOpened` / `lastOpened` / `formatOpened(iso): "opened 2 days ago"` (relative words: today, yesterday, N days ago, N weeks ago).

- [ ] **Step 4: Run** `bun run vitest run host/src && bun run --cwd host tsc` → PASS.
- [ ] **Step 5: Commit**
```bash
git add host src-tauri/src
git commit -m "feat(host): sidecar/identity hooks, config store, vault-name rules, constellation layout, graph sampling

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 5: The designed landing, Settings and the vault app bar

**Files:**
- Replace: `host/src/screens/Landing.tsx`; Create: `host/src/landing/VaultTile.tsx`, `host/src/landing/Constellation.tsx`, `host/src/landing/FirstRun.tsx`, `host/src/landing/StatusStrip.tsx`, `host/src/screens/Settings.tsx`, `host/src/settings/Identity.tsx`, `host/src/settings/Vaults.tsx`, `host/src/settings/Diagnostics.tsx`, `host/src/settings/About.tsx`, `host/src/host.css` (tokens), `host/public/fonts/` (Inter + Source Serif 4 woff2, self-hosted — the app must work offline)
- Modify: `host/src/App.tsx` (routes: landing, vault, settings/:section; passes `auth` hint into `declareDesktopHost` — host config `auth: protected ? "protected" : "open"`), `host/src/screens/VaultScreen.tsx` (app bar: back, name, protected badge, identity chip, Settings gear)
- Test: `host/src/landing/Landing.test.tsx` (RTL + jsdom): first-run form validation and Enter-to-create; tiles render name + sentence metadata; protected tile shows "Protected — sign in to open" and does not open when signed out; `host/src/settings/Vaults.test.tsx`: switch disabled with "Sign in first" when signed out.

**Interfaces:** consumes Task 4 hooks and `fetchVaults/createVault` (Plan 0), `fetchVaultGraph`, Tauri `set_local_protection`, control `/auth/*`, `/local/protection`, `PATCH /vaults/:id` (rename — add to the sidecar: `setDriveName` mutation, 200 `{ vault }`).

- [ ] **Step 1: Failing RTL tests** (two files; key assertions)
```tsx
// host/src/landing/Landing.test.tsx
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Landing } from "../screens/Landing.js";
const info = { origin: "http://127.0.0.1:4201", graphqlUrl: "http://127.0.0.1:4201/graphql", controlOrigin: "http://127.0.0.1:4202", controlToken: "t" };
describe("Landing", () => {
  it("first run: Enter in the name field creates and opens the vault", async () => {
    const onOpen = vi.fn();
    const api = { fetchVaults: vi.fn(async () => []), createVault: vi.fn(async (name: string) => ({ id: "v1", slug: "s", name, noteCount: 0 })), fetchGraph: vi.fn(async () => ({ noteCount: 0, nodeIds: [], edges: [] })) };
    render(<Landing info={info} engineState="ready" identity={null} onOpen={onOpen} onSettings={() => {}} api={api} />);
    const input = await screen.findByLabelText("Name");
    fireEvent.change(input, { target: { value: "Research notes" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ name: "Research notes" })));
  });
  it("shows tiles with sentence metadata and keeps a protected vault closed when signed out", async () => {
    const api = { fetchVaults: vi.fn(async () => [{ id: "v1", slug: "s", name: "Team wiki", noteCount: 371 }]), createVault: vi.fn(), fetchGraph: vi.fn(async () => ({ noteCount: 371, nodeIds: ["a", "b"], edges: [["a", "b"]] })) };
    const onOpen = vi.fn();
    render(<Landing info={info} engineState="ready" identity={{ authenticated: false, pending: false, expired: false }} protectedMode onOpen={onOpen} onSettings={() => {}} api={api} />);
    expect(await screen.findByText(/371 notes/)).toBeTruthy();
    expect(screen.getByText("Protected — sign in to open")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Team wiki/ }));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
```
- [ ] **Step 2: Run** → FAIL (props/components missing).
- [ ] **Step 3: Implement** the screens per spec §5.7: header (app name left; identity chip or "Sign in" right; gear), `Vaults` heading with "New vault" and "Connect remote vault" (the latter disabled until Phase 3 with title "Coming in a later version"), tile grid (most recent tile `grid-column: span 2` with a larger constellation; `<Constellation>` renders an inline `<svg>` of `layoutConstellation` points and edges in the vault app's node colours — import `GRAPH_NODE_COLORS` only if the package exports it; otherwise use `var(--bai-accent)` at 70 % opacity for nodes and `var(--bai-text-faint)` for edges), tile metadata sentence via `formatOpened`, protected badge (lock in `var(--bai-status-draft)`, the app's amber), `FirstRun` inline form (label "Name", button "Create vault", `validateVaultName`, Enter submits), `StatusStrip` (dot: `var(--bai-status-draft)` while starting with the live step text "Starting the engine — opening your store…", `var(--bai-status-canonical)` when "Ready"; the privacy sentence; Settings link; version). Settle animation: when `engineState` flips to ready, constellation points animate from a collapsed centre to their positions once (`@media (prefers-reduced-motion: reduce)` disables). `Settings`: tabs Identity (Sign in / Signing in… with URL fallback / signed in as `displayAddress`, expiry date, Renew, Sign out), Vaults (the switch "Protect local vaults — requires sign-in", disabled + "Sign in first" when signed out; per-vault rename inline), Diagnostics (engine state, ports, app-data path, **Connect your tools** block with copy buttons: `switchboard init --url http://127.0.0.1:<port>/graphql --name local-vault` and `http://127.0.0.1:<port>/mcp`, plus the protected-mode token note), About (app version from `import.meta.env.VITE_APP_VERSION`, stack version constant, package version from `@powerhousedao/knowledge-note/package.json` import). `VaultScreen` app bar gains the identity chip and the gear. Fonts self-hosted in `host/public/fonts` with `@font-face` in `host.css`; drop the Google Fonts `<link>`. Theme: keep Plan 0's theme root (`initTheme()` once in `App`, `data-bai-theme={theme}` on the host root, `ph:theme` defaulting to `dark` from the `index.html` inline script) and add the Settings control **Theme — Dark (default) / Light / System**, written through `setTheme` from `reactor-browser`; the Rust `UiConfig.theme` mirrors it for the shell's own chrome.
- [ ] **Step 4: Run** `bun run vitest run host/src && bun run --cwd host tsc`; then `bun run dev`: walk the landing, create, open, protect (sign in first), confirm the engine restarts and the vault requires sign-in state is reflected (tile badge; AuthGate inside the app passes because the host's bearer provider is wired in Phase 3 — in Phase 1 the protected vault opens only through the package's ambient Renown session, which the host does not have: **expected**, the tile shows "Protected — sign in to open" and opening is blocked until Plan 3 adds the bearer provider; note this in the Vaults settings as "Opening protected vaults arrives with remote vaults").
- [ ] **Step 5: Commit**
```bash
git add host
git commit -m "feat(host): designed landing with constellation tiles, first run, status strip; Settings (identity, vaults, diagnostics, about)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 6: e2e additions

- [ ] Extend `e2e/open-vault.spec.ts` with: first run by keyboard only (type name, Enter → vault app visible); the status strip shows "Ready" and the privacy sentence; Settings › Diagnostics shows the `switchboard init` line containing the live port; Settings › Vaults shows the protection switch disabled with "Sign in first" when signed out. Run `bun run e2e` → PASS. Commit `test(e2e): landing, settings and protection-switch states`.

## Done when
- The landing matches §5.7 (tiles with constellations, first-run inline create, status strip); sign-in works end to end through the system browser; the protection switch restarts the engine into protected mode and back; Settings has Identity, Vaults (rename, protect), Diagnostics (Connect your tools), About; all gates green.
