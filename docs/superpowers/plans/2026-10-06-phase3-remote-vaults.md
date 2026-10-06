# Desktop Knowledge Vault — Phase 3 "Remote vaults" Implementation Plan (outline — expand to bite-sized TDD steps before execution)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Interfaces, contracts and tests are fixed here; expand each task into write-test / run / implement / run / commit steps when Phase 2 has landed.

**Goal:** A signed-in user connects a remote vault (`https://switchboard.knowledge-vault.vetra.io/graphql`, drive `c5893e1b-854b-49b1-b8aa-6b133ab87969` or its slug) and opens it in client mode with their Renown bearer; authorisation failures, expiry, offline and too-old servers are explained in place. The same mechanism opens **protected local vaults**.

**Architecture:** Every vault is an origin plus a bearer provider. The host keeps one `GraphQLReactorClient` per origin, swaps `window.ph` client/cache and re-declares the host config (`switchboardOrigin`, `getBearerToken`) when a vault is opened; bearers come from the sidecar's `/auth/token?aud=<origin>` and are cached until shortly before expiry. The vault package learns to take its bearer from the host config (the webview has no Renown session of its own). Remote entries live in `config.json` (Tauri) / localStorage (browser dev).

**Tech Stack:** as before.

**Spec:** §2 (client mode only), §5.5 (remote vaults), §5.6 (config entries), §9 (remote-vault errors), §7 (host-provided bearer). **Prerequisites:** Plans 0–2.

## Global Constraints

- Plans 0–2 constraints apply.
- Client mode only: nothing from a remote vault is stored locally except the entry `{ kind, id, name, switchboardUrl }` and the last-opened time.
- Bearers are minted with `aud` = the exact remote origin and a 10-minute lifetime; never logged; never sent to a different origin.
- Remote-vault copy: "Vault server (Switchboard URL)", "Drive id or slug", "Check access", "Connect vault"; refusals: "Sign in first.", "Ask the vault's administrator for READ on this drive. Your address: 0x…", "This vault's server is too old for this app.", "Can't reach this server right now."

## Review Focus

1. **A pasted URL with a path or trailing slash** (`…/graphql`, `…/graphql/`, `…/d/<id>`): the origin is derived and shown; the drive id is taken from a `/d/<id>` URL when present — Task 2 `remote-address.test.ts`.
2. **Token expiry mid-session**: a 401 from the remote during use triggers one token refresh and retry; a second 401 shows the renew banner — Task 3 `token-cache.test.ts` and the client-middleware test.
3. **Switching vaults quickly** (open A, immediately open B): the client for A must be disposed and no A request may land after B is selected — Task 3 `reactor-registry.test.ts` "dispose on switch".
4. **A remote drive whose app is not the Knowledge Vault** (`preferredEditor` missing or `workflow-studio`): refused at Check access with "That drive isn't a Knowledge Vault." — Task 2 test.
5. **Protected local vault**: opening it uses the same bearer path with `aud` = the local origin, and `AuthGate` passes — Task 4 e2e in protected mode.

---

## Part A — vault package (`bai-knowledge-note`)

### Task 1: Host-provided bearer

**Files:** Modify `editors/shared/host-config.ts` (`getBearerToken?: () => Promise<string | undefined>`), `editors/shared/authed-fetch.ts` (`getBearerToken` prefers the host's), tests in both test files.

- [ ] **Step 1: Tests** — host-config: a config with `getBearerToken` is stored as-is (function identity); authed-fetch: with `setHostConfig({ …, getBearerToken: async () => "host-jwt" })`, `getBearerToken()` resolves `"host-jwt"` and `ambientRenownTokenProvider` is not called (mock `@powerhousedao/reactor-browser`); without a host provider the ambient path is used.
- [ ] **Step 2: Implement**
```ts
// authed-fetch.ts
export const getBearerToken: TokenProvider = async () => {
  const host = getHostConfig();
  if (host?.getBearerToken) {
    try { return await host.getBearerToken(); } catch { return undefined; }
  }
  try { return await ambientRenownTokenProvider(); } catch { return undefined; }
};
```
`setHostConfig` copies `getBearerToken` when present. `enableRemoteFirst` (Plan 0 Task 4) already reuses the host's client, whose `tokenProvider` is the host's — the package's own fetches (`authHeaders`, `authedGraphQLFetch`, AuthGate's probe, `use-drive-init`) now carry the same bearer.
- [ ] **Step 3:** `bun run tsc && bun run lint:fix && bun run test && bun run build`; commit `feat(shared): take the bearer from a declared host when it provides one`.

---

## Part B — desktop repository

### Task 2: Remote address parsing and access check (sidecar + host)

**Files:**
- Create: `host/src/remote/remote-address.ts` (+ test): `parseRemoteAddress(urlText: string, idText: string): { origin: string; graphqlUrl: string; driveRef: string } | { error: string }`; Create `sidecar/src/remote-check.ts` (+ test): `checkRemoteAccess({ origin, driveRef, token, fetchImpl })` → `{ ok: true; drive: { id, slug, name } } | { ok: false; reason: "sign-in" | "forbidden" | "not-a-vault" | "too-old" | "unreachable"; detail?: string }`; control route `POST /remote/check { origin, driveRef }` (mints the bearer for `origin` itself).
- The check: (1) introspect `{ __type(name: "Query") { fields { name args { name } } } }` → the `document` field must have an `idOrSlug` arg else `too-old`; (2) `GET <origin>/d/<driveRef>` with the bearer: 401 → `sign-in`, 403 → `forbidden`, network error → `unreachable`, 200 → JSON; `meta.preferredEditor !== "knowledge-vault"` → `not-a-vault`.

- [ ] **Step 1: Tests** (cases in Review Focus 1 and 4, plus each status code → reason). **Step 2: Implement.** **Step 3: Commit** `feat(remote): parse remote addresses and check access with the user's bearer`.

### Task 3: Per-origin clients, token cache, config entries, the Connect-remote form

**Files:**
- Create: `host/src/remote/token-cache.ts` (+ test): `createTokenProvider(info, origin): () => Promise<string | undefined>` caching the token until 60 s before `expiresIn`; `host/src/reactor-registry.ts` (+ test): `useVaultClient(origin, tokenProvider)` → installs/reuses a `GraphQLReactorClient` for the origin (`setReactorClient`, `setDocumentCache(new DocumentCache(client))`), disposes the previous origin's client and cache on switch; `host/src/remote/ConnectRemoteForm.tsx` (fields, "Check access" → shows the drive name and access, "Connect vault" → adds `{ kind: "remote", id, slug, name, switchboardUrl }` to the config store); `host/src/remote/RemoteBanner.tsx` (401 → "Your sign-in expired" + Renew; 403 → administrator sentence with the address; offline → "You're offline — this vault lives on its server."; too-old → sentence).
- Modify: `host/src/App.tsx` (vault route carries `origin`; `declareDesktopHost(origin, { auth, getBearerToken })`), `host/src/screens/Landing.tsx` (remote tiles with the "remote" mark; "Connect remote vault" enabled), `host/src/screens/VaultScreen.tsx` (uses `useVaultClient`; 401/403 handling via a response middleware on the client's `createClient(url, middleware)` that retries once after a token refresh and then raises `RemoteBanner` state).
- `declareDesktopHost` (Plan 0) gains an options object: `declareDesktopHost(origin, { auth?: "open" | "protected"; getBearerToken?: () => Promise<string | undefined> })`.

- [ ] **Step 1: Tests** — token cache (fresh → one fetch; second call within TTL → no fetch; after TTL − 60 s → refetch); registry dispose-on-switch (spy `dispose` on the previous client); form validation (empty id → "Enter the drive id or slug."); banner mapping.
- [ ] **Step 2: Implement.** The client for a protected local vault is the local origin with the same provider (`aud` = local origin). Open local vaults use no provider.
- [ ] **Step 3: Run** gates; by hand: sign in, connect `https://switchboard.knowledge-vault.vetra.io/graphql` + `c5893e1b-854b-49b1-b8aa-6b133ab87969`, open it: search, graph and editors work read-only or read-write per your grant; the network panel shows only that origin. **Step 4: Commit** `feat(remote): connect and open remote vaults in client mode`.

### Task 4: e2e
- [ ] Browser e2e against the local sidecar: add a "remote" entry pointing at the local origin (`http://127.0.0.1:4201/graphql`) with the vault's id → opens through the remote code path; an unreachable address (`http://127.0.0.1:9/graphql`) shows "Can't reach this server right now."; desktop smoke in protected mode (after `set_local_protection`): the protected tile opens after sign-in — this needs a real Renown session, so it is a **manual** checklist item recorded in `e2e/MANUAL.md`, not an automated test. Commit `test(e2e): remote vault paths`.

## Done when
The hosted vault opens for an authorised, signed-in user; refusals and expiry are explained in the spec's words; protected local vaults open through the same path; all gates green.
