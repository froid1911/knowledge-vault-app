# Desktop Knowledge Vault — Phase 0 "Foundation" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local Knowledge Vault opens inside the desktop window: the Node sidecar boots the Switchboard on plain PGlite data directories, the host web app mounts the unchanged vault app against it, and the Rust shell starts and stops the sidecar — in development mode (system Node, Vite dev server, `tauri dev`).

**Architecture:** Two repositories. In `bai-knowledge-note` the vault package learns to run under a non-Connect host (a declared Switchboard origin, no Connect-only boot work, reuse of a host-provided client, bounded probe retries). In `desktop-knowledge-vault` a bun workspace holds the sidecar (`startSwitchboard` + loopback control API), the host (React, built on `reactor-browser` setters/hooks exactly as Connect is) and the Tauri shell (spawns the sidecar, relays its readiness, serves the host in dev via Vite). Everything the vault app needs from "Connect" is provided by `reactor-browser` globals the host installs.

**Tech Stack:** TypeScript 5.9 (strict, NodeNext), bun 1.4 (local toolchain), Node 26 (sidecar runtime in dev), Vite 8 + React 19, `@powerhousedao/*` **6.2.3-dev.44** (`switchboard`, `reactor-browser`, `design-system`, `workflow`), `@electric-sql/pglite` 0.3.15, vitest 4.1, Rust 1.98 + Tauri 2.12 (`tauri-plugin-shell`), Playwright (e2e, browser mode).

**Spec:** `docs/superpowers/specs/2026-10-06-desktop-knowledge-vault-design.md` (this repo). Sections implemented here: §3 (architecture, dev loop), §4.1–4.3 and §4.6 (sidecar entry, env, storage, control API skeleton + vault create/list), §5.1 and §5.3 (host stack, wiring contract), §7.1–7.2 (package: origin override, host-aware boot, retry cap) plus the client-reuse part of §7, §13 webview parity check. Phase 1+ items (landing design §5.7, sign-in §5.4, protection switch, pipeline, remote vaults, conversion, packaging) are later plans.

## Global Constraints

- Every `@powerhousedao/*` and `document-model` dependency is pinned to **`6.2.3-dev.44`** in both repos; `@powerhousedao/document-engineering` keeps its own version (`1.40.5`); `@electric-sql/pglite` is **`0.3.15`** (must equal the Switchboard's). `scripts/check-stack-versions.mjs` fails the build on a mismatch.
- `bai-knowledge-note` rules (its CLAUDE.md): **bun only** (`bun install`, `bun run …`, `bunx`; never npm/pnpm/yarn), relative imports carry `.js`, no `@/*` alias, `bun run tsc && bun run lint:fix && bun run test` after changes; `bun run build` after any change the host must see (the host consumes `dist/`).
- Desktop repo: `bun` for installs and scripts; `node` for the sidecar at runtime; sidecar code never uses `Bun.*`.
- Ports: host **4200**, sidecar **4201**, control **4202**, loopback only (`127.0.0.1`), **never 4001/3001**; all three fall back upward when busy and the real values travel in the readiness line / `sidecar_info`.
- The sidecar never reads a `.env` file; the shell (or `scripts/dev.mjs`) passes every variable explicitly. Telemetry variables (`SENTRY_DSN`, `ENABLE_TRACING`, `PYROSCOPE_SERVER_ADDRESS`) are never set.
- User-facing copy: *Vault, Notes, Sources, Pipeline, Sign in, Protected, Remote vault, engine*; never *Switchboard, sidecar, reactor, drive, PGlite, bearer* (those belong to Diagnostics and code). Sentence case, active verbs.
- Nothing is imported from another repo by path; the desktop repo depends on `@powerhousedao/knowledge-note` via `file:../bai-knowledge-note` during development.
- Commits: conventional prefix (`feat`, `fix`, `test`, `chore`, `docs`), imperative subject, body explains why; every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Desktop repo work happens on `dev`; package work on branch `feat/desktop-host-mode` cut from `remote-first-vault`.

## Review Focus

1. **App-data paths with spaces or non-ASCII** (`~/Library/Application Support/…`): the sidecar env and PGlite directories must be created and passed intact — Task 7 `switchboardEnv` test uses `"/tmp/Knowledge Vault äö/data"`; Task 10 `SidecarEnv` test uses the same path.
2. **Port 4201 already taken at launch**: the shell must pick the next port and the host must learn it from the readiness line, never assume 4201 — Task 10 `pick_free_port` test binds 4201 first; Task 8 `sidecar.test.ts` derives origins from a non-default port.
3. **The vault package imported before the host declared itself**: the package-load boot would run in Connect mode — Task 1 test shows `getHostConfig()` is read at call time; Task 3 test shows `startRemoteFirstBoot` and a running `sweep` both stop under a desktop host; Task 8 `main.tsx` declares the host and only then dynamically imports `App` (which imports the package); `bootstrap.test.ts` pins the slot's name and shape.
4. **A drive that is not a vault** (the Workflows drive, `preferredEditor: workflow-studio`) must not be listed or openable as a vault — Task 7 `listVaultDrives` test includes one and expects it filtered out.
5. **Non-JSON lines on the sidecar's stdout** (Switchboard logs, deprecation warnings): the shell's parser must skip them and still find the readiness line — Task 10 `parse_ready_line` test feeds mixed output; Task 9 `parseReadyLine` test does the same for the dev script.

---

## Part A — vault package (`/home/beast/Documents/Powerhouse/bai-knowledge-note`)

Start: `git checkout remote-first-vault && git pull --ff-only && git checkout -b feat/desktop-host-mode`.

### Task 1: Host configuration contract

**Files:**
- Create: `editors/shared/host-config.ts`
- Test: `editors/shared/host-config.test.ts`

**Interfaces:**
- Produces: `type KnowledgeVaultHostKind = "connect" | "desktop"`, `type KnowledgeVaultHostConfig = { kind: KnowledgeVaultHostKind; switchboardOrigin: string }`, `getHostConfig(): KnowledgeVaultHostConfig | undefined`, `setHostConfig(config: KnowledgeVaultHostConfig | undefined): void`, `isDesktopHost(): boolean`, and the global slot name `__knowledgeVaultHost` (the desktop host writes this global directly before loading the package).

- [ ] **Step 1: Write the failing test**

```ts
// editors/shared/host-config.test.ts
import { afterEach, describe, expect, it } from "vitest";
import {
  getHostConfig,
  isDesktopHost,
  setHostConfig,
} from "./host-config.js";

afterEach(() => setHostConfig(undefined));

describe("host-config", () => {
  it("is empty until a host declares itself", () => {
    expect(getHostConfig()).toBeUndefined();
    expect(isDesktopHost()).toBe(false);
  });

  it("round-trips a declaration through the global slot", () => {
    setHostConfig({ kind: "desktop", switchboardOrigin: "http://127.0.0.1:4201" });
    expect(getHostConfig()).toEqual({
      kind: "desktop",
      switchboardOrigin: "http://127.0.0.1:4201",
    });
    expect(isDesktopHost()).toBe(true);
  });

  it("reads the global at call time, so a late declaration is still seen", () => {
    (globalThis as Record<string, unknown>).__knowledgeVaultHost = {
      kind: "desktop",
      switchboardOrigin: "http://127.0.0.1:4300",
    };
    expect(getHostConfig()?.switchboardOrigin).toBe("http://127.0.0.1:4300");
  });

  it("rejects an origin that carries a path", () => {
    expect(() =>
      setHostConfig({ kind: "desktop", switchboardOrigin: "http://127.0.0.1:4201/graphql" }),
    ).toThrow(/origin without a path/);
    expect(getHostConfig()).toBeUndefined();
  });

  it("clears the slot when set to undefined", () => {
    setHostConfig({ kind: "connect", switchboardOrigin: "http://localhost:4001" });
    setHostConfig(undefined);
    expect(getHostConfig()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run vitest run editors/shared/host-config.test.ts`
Expected: FAIL — `Cannot find module './host-config.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// editors/shared/host-config.ts
/**
 * How a host that is not Connect declares itself to the vault package.
 *
 * The desktop app writes `globalThis.__knowledgeVaultHost` BEFORE it imports
 * this package, so that `resolveSwitchboardOrigin` follows the declared origin
 * instead of guessing from the hostname, and the package-load boot
 * (`startRemoteFirstBoot`) stays out of Connect-only work. Read at call time,
 * never cached: a host may declare itself after a module was evaluated.
 */
export type KnowledgeVaultHostKind = "connect" | "desktop";

export type KnowledgeVaultHostConfig = {
  kind: KnowledgeVaultHostKind;
  /** Origin every vault call goes to, e.g. "http://127.0.0.1:4201". No path, no trailing slash. */
  switchboardOrigin: string;
};

const SLOT = "__knowledgeVaultHost";
type HostGlobal = typeof globalThis & { [SLOT]?: KnowledgeVaultHostConfig };
const ORIGIN = /^https?:\/\/[^/\s?#]+$/;

export function getHostConfig(): KnowledgeVaultHostConfig | undefined {
  return (globalThis as HostGlobal)[SLOT];
}

export function setHostConfig(config: KnowledgeVaultHostConfig | undefined): void {
  const g = globalThis as HostGlobal;
  if (config === undefined) {
    delete g[SLOT];
    return;
  }
  if (!ORIGIN.test(config.switchboardOrigin)) {
    throw new Error(
      `switchboardOrigin must be an origin without a path, got "${config.switchboardOrigin}"`,
    );
  }
  g[SLOT] = { kind: config.kind, switchboardOrigin: config.switchboardOrigin };
}

export function isDesktopHost(): boolean {
  return getHostConfig()?.kind === "desktop";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run vitest run editors/shared/host-config.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add editors/shared/host-config.ts editors/shared/host-config.test.ts
git commit -m "feat(shared): host configuration contract for non-Connect hosts

A desktop host declares its kind and Switchboard origin in a global slot
before the package loads; endpoint resolution and the package-load boot
will follow it in the next commits.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 2: Endpoint resolver follows the declared origin

**Files:**
- Modify: `editors/shared/subgraph-endpoint.ts` (functions `resolveSwitchboardOrigin`, `resolveKnowledgeGraphEndpoint`)
- Test: `editors/shared/subgraph-endpoint.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `getHostConfig` (Task 1).
- Produces: unchanged signatures `resolveSwitchboardOrigin(): string | null`, `resolveReactorEndpoint(): string`, `resolveAuthEndpoint(): string`, `resolveKnowledgeGraphEndpoint(): string` — now honouring the host config first.

- [ ] **Step 1: Write the failing tests** (append to `editors/shared/subgraph-endpoint.test.ts`, after the existing imports add `import { setHostConfig } from "./host-config.js";`)

```ts
describe("declared host configuration", () => {
  afterEach(() => setHostConfig(undefined));

  it("wins over the hostname heuristics", () => {
    onHost("localhost"); // would otherwise map to http://localhost:4001
    setHostConfig({ kind: "desktop", switchboardOrigin: "http://127.0.0.1:4201" });
    expect(resolveSwitchboardOrigin()).toBe("http://127.0.0.1:4201");
    expect(resolveReactorEndpoint()).toBe("http://127.0.0.1:4201/graphql");
    expect(resolveAuthEndpoint()).toBe("http://127.0.0.1:4201/graphql/auth");
    expect(resolveKnowledgeGraphEndpoint()).toBe(
      "http://127.0.0.1:4201/graphql/knowledgeGraph",
    );
  });

  it("wins over the VITE_SUBGRAPH_URL escape hatch", () => {
    vi.stubEnv("VITE_SUBGRAPH_URL", "https://elsewhere.example/graphql/knowledgeGraph");
    setHostConfig({ kind: "desktop", switchboardOrigin: "http://127.0.0.1:4201" });
    expect(resolveKnowledgeGraphEndpoint()).toBe(
      "http://127.0.0.1:4201/graphql/knowledgeGraph",
    );
    vi.unstubAllEnvs();
  });

  it("leaves Connect behaviour untouched when no host is declared", () => {
    onHost("knowledge-vault.vetra.io");
    expect(resolveSwitchboardOrigin()).toBe("https://switchboard.knowledge-vault.vetra.io");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run vitest run editors/shared/subgraph-endpoint.test.ts`
Expected: FAIL — the two new assertions receive `http://localhost:4001…` / the env URL.

- [ ] **Step 3: Implement**

At the top of `editors/shared/subgraph-endpoint.ts` add `import { getHostConfig } from "./host-config.js";`. Change the two functions:

```ts
export function resolveSwitchboardOrigin(): string | null {
  // A host that declared itself (the desktop app) is never guessed at.
  const declared = getHostConfig();
  if (declared) return declared.switchboardOrigin;
  const hostname = globalThis.window?.location?.hostname;
  if (!hostname) return null;
  // … existing body unchanged from here …
}

export function resolveKnowledgeGraphEndpoint(): string {
  const declared = getHostConfig();
  if (declared) return `${declared.switchboardOrigin}${SUBGRAPH_PATH}`;
  const envUrl =
    typeof import.meta !== "undefined" &&
    (import.meta as { env?: Record<string, string> }).env?.VITE_SUBGRAPH_URL;
  if (envUrl) return envUrl;
  const origin = resolveSwitchboardOrigin();
  return origin ? `${origin}${SUBGRAPH_PATH}` : SUBGRAPH_PATH;
}
```

Update the file's header comment priority list: insert `0. A declared host configuration (desktop app) — see host-config.ts` above item 1.

- [ ] **Step 4: Run the tests**

Run: `bun run vitest run editors/shared/subgraph-endpoint.test.ts`
Expected: PASS (all existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add editors/shared/subgraph-endpoint.ts editors/shared/subgraph-endpoint.test.ts
git commit -m "feat(shared): endpoint resolver follows a declared host origin

The desktop host runs on 127.0.0.1 with the Switchboard on a port of its
own; the localhost->4001 heuristic would send every call to a developer's
Vetra. A declared origin now wins over hostname rules and the Vite env.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 3: Package-load boot — no-op under a desktop host, bounded retries

**Files:**
- Modify: `editors/knowledge-vault/lib/boot.ts` (constants near line 66, `sweep`, `startRemoteFirstBoot`)
- Test: `editors/knowledge-vault/lib/boot.test.ts` (append two tests)

**Interfaces:**
- Consumes: `isDesktopHost` (Task 1).
- Produces: unchanged export `startRemoteFirstBoot(): void`; new behaviour: returns at once when `isDesktopHost()`, a running sweep stops when a desktop host appears, and a failed `adopt()` is retried after `min(30 s, 1 s × 2^(n−1))` instead of on the next 400 ms tick.

- [ ] **Step 1: Write the failing tests** (append inside the existing `describe("startRemoteFirstBoot / adopt", …)` block, which already has fake timers, `bootWith`, `makeSync`, `makeRemote`, `stubVaultLookup`)

```ts
  it("DESKTOP HOST: does nothing — no sync listing, no Switchboard probe", async () => {
    (globalThis as Record<string, unknown>).__knowledgeVaultHost = {
      kind: "desktop",
      switchboardOrigin: "http://127.0.0.1:4201",
    };
    try {
      stubVaultLookup(VAULT_APP);
      const sync = makeSync(makeRemote([]));
      await bootWith(sync);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(sync.list).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(enableRemoteFirstMock).not.toHaveBeenCalled();
    } finally {
      delete (globalThis as Record<string, unknown>).__knowledgeVaultHost;
    }
  });

  it("BACKOFF: an unreachable Switchboard is probed with exponential delay, not every tick", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
    );
    const sync = makeSync(makeRemote([]));
    await bootWith(sync);
    // 400 ms polling would make ~25 attempts in 10 s; backoff (0, 1, 3, 7 s) makes 4.
    await vi.advanceTimersByTimeAsync(10_000);
    const attempts = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(attempts).toBeGreaterThanOrEqual(3);
    expect(attempts).toBeLessThanOrEqual(5);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run vitest run editors/knowledge-vault/lib/boot.test.ts`
Expected: FAIL — the desktop test sees `sync.list` called; the backoff test counts ~25 attempts.

- [ ] **Step 3: Implement**

In `editors/knowledge-vault/lib/boot.ts`:

Add the import next to the other `../../shared/…` imports:
```ts
import { isDesktopHost } from "../../shared/host-config.js";
```

After `const POLL_MS = 400;` add:
```ts
/** A failed adoption is retried after 1 s, 2 s, 4 s … capped at 30 s — not on the next tick. */
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;
/** Earliest time (ms since epoch) a drive may be adopted again, by driveId. */
const retryAt = new Map<string, number>();
/** Consecutive failures per drive, for the backoff exponent. */
const failures = new Map<string, number>();
```

Replace the body of the `for (const remote of remotes)` loop in `sweep` with:
```ts
  for (const remote of remotes) {
    const driveId = remote?.meta?.collectionId?.driveId;
    if (!driveId || claimed.has(driveId)) continue;
    if ((retryAt.get(driveId) ?? 0) > Date.now()) continue;
    // Claim before awaiting so a slow header lookup cannot be started twice.
    claimed.add(driveId);
    void adopt(driveId, remote, sync)
      .then(() => {
        failures.delete(driveId);
        retryAt.delete(driveId);
      })
      .catch((error) => {
        claimed.delete(driveId);
        const n = (failures.get(driveId) ?? 0) + 1;
        failures.set(driveId, n);
        retryAt.set(driveId, Date.now() + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (n - 1)));
        console.warn(
          `[RemoteFirst] Could not neutralise drive ${driveId.slice(0, 8)} at boot (attempt ${n}):`,
          error,
        );
      });
  }
```

At the top of `sweep`, before the `MAX_WAIT_MS` check, add:
```ts
  // A declared desktop host has no sync manager and owns the client itself.
  if (isDesktopHost()) {
    clearInterval(timer);
    return;
  }
```

In `startRemoteFirstBoot`, after `if (typeof window === "undefined") return;` add:
```ts
  if (isDesktopHost()) return;
```

- [ ] **Step 4: Run the tests**

Run: `bun run vitest run editors/knowledge-vault/lib/boot.test.ts`
Expected: PASS (all existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add editors/knowledge-vault/lib/boot.ts editors/knowledge-vault/lib/boot.test.ts
git commit -m "fix(boot): skip Connect-only boot under a desktop host; back off failed adoptions

A failed adopt() was retried on every 400 ms sweep tick — 250 requests in
100 s against an unreachable Switchboard. Retries now back off (1 s … 30 s).
Under a declared desktop host the boot does nothing: there is no sync
manager to neutralise and the host installs the client.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 4: `enableRemoteFirst` reuses a host-provided GraphQL client

**Files:**
- Modify: `editors/knowledge-vault/lib/remote-first.ts` (`enableRemoteFirst`, lines ≈739–815)
- Test: `editors/knowledge-vault/lib/remote-first.test.ts` (new)

**Interfaces:**
- Consumes: `isGraphQLReactorClient` from `@powerhousedao/reactor-browser`.
- Produces: unchanged `enableRemoteFirst(options: { endpoint: string; driveId: string; driveSlug?: string }): RemoteFirstHandle`; when `window.ph.reactorClient` is already a `GraphQLReactorClient`, `handle.remoteClient` **is** that client, no second client is built and no proxy is installed; the `VaultDocumentCache` is still installed.

- [ ] **Step 1: Write the failing test**

```ts
// editors/knowledge-vault/lib/remote-first.test.ts
/**
 * Under the desktop host, `window.ph.reactorClient` is already a
 * GraphQLReactorClient the host built (with its own auth and realtime). The
 * vault must reuse it rather than building a second client and routing one
 * through the other; the vault's own document cache is still installed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ctor = vi.hoisted(() => vi.fn());
const setReactorClientMock = vi.hoisted(() => vi.fn());
const setDocumentCacheMock = vi.hoisted(() => vi.fn());

vi.mock("@powerhousedao/reactor-browser", () => ({
  GraphQLReactorClient: class {
    get = vi.fn();
    getOperations = vi.fn();
    constructor(options: unknown) {
      ctor(options);
    }
  },
  isGraphQLReactorClient: (c: unknown) =>
    !!c && (c as { __hostClient?: boolean }).__hostClient === true,
  setReactorClient: setReactorClientMock,
  setDocumentCache: setDocumentCacheMock,
  createClient: vi.fn(() => ({})),
  makeAuthMiddleware: vi.fn(() => (fn: unknown) => fn),
  addPromiseState: vi.fn((p: unknown) => p),
}));
vi.mock("../../shared/authed-fetch.js", () => ({ getBearerToken: vi.fn(async () => undefined) }));
vi.mock("../../shared/notify.js", () => ({ notifyRequestError: vi.fn() }));
vi.mock("./remote-reactor.js", () => ({ announceDocumentMutation: vi.fn() }));

function stubWindow(ph: Record<string, unknown>) {
  vi.stubGlobal("window", {
    ph,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
}

describe("enableRemoteFirst under a host-provided client", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("reuses the host's GraphQLReactorClient: no second client, no proxy, cache installed", async () => {
    const hostClient = { __hostClient: true, get: vi.fn(), getOperations: vi.fn() };
    stubWindow({ reactorClient: hostClient });
    const { enableRemoteFirst } = await import("./remote-first.js");
    const handle = enableRemoteFirst({ endpoint: "http://127.0.0.1:4201/graphql", driveId: "d1" });
    expect(ctor).not.toHaveBeenCalled();
    expect(setReactorClientMock).not.toHaveBeenCalled();
    expect(handle.remoteClient).toBe(hostClient);
    expect(setDocumentCacheMock).toHaveBeenCalledTimes(1);
  });

  it("still builds its own client and proxies a worker client under Connect", async () => {
    const workerClient = { get: vi.fn(), getOperations: vi.fn(), execute: vi.fn() };
    stubWindow({ reactorClient: workerClient });
    const { enableRemoteFirst } = await import("./remote-first.js");
    const handle = enableRemoteFirst({ endpoint: "http://localhost:4001/graphql", driveId: "d1" });
    expect(ctor).toHaveBeenCalledTimes(1);
    expect(setReactorClientMock).toHaveBeenCalledTimes(1);
    expect(handle.remoteClient).not.toBe(workerClient);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run vitest run editors/knowledge-vault/lib/remote-first.test.ts`
Expected: FAIL on the first test — `ctor` called once and `handle.remoteClient` is not the host client.

- [ ] **Step 3: Implement**

In `editors/knowledge-vault/lib/remote-first.ts` add `isGraphQLReactorClient` to the value import from `@powerhousedao/reactor-browser`. In `enableRemoteFirst`, replace everything from `const withAuth = makeAuthMiddleware(getBearerToken);` down to (and including) the closing `}` of `if (previousClient) { … setReactorClient(hybrid as never); }` with:

```ts
  const previousClient = phSlots().reactorClient;
  const previousCache = phSlots().documentCache;
  // A host that already installed a Switchboard-backed client — the desktop
  // app — owns its auth and realtime. Reuse it: a second client would mean two
  // sockets and one client routed through another for nothing.
  const hostClient = isGraphQLReactorClient(previousClient) ? previousClient : undefined;
  const remoteClient = hostClient ?? buildVaultClient(options.endpoint);
  if (previousClient && !hostClient) {
    const worker = previousClient as unknown as AnyClient;
    const remote = remoteClient as unknown as AnyClient;
    const hybrid = new Proxy(worker, {
      // … the existing Proxy handler, unchanged …
    });
    setReactorClient(hybrid as never);
  }
```

and add this module-level function above `enableRemoteFirst` (it holds the code that used to build the client inline; the comments about auth middleware move with it):

```ts
/** The vault's own Switchboard client, authenticated per request with the Renown bearer. */
function buildVaultClient(endpoint: string): GraphQLReactorClient {
  const withAuth = makeAuthMiddleware(getBearerToken);
  const sdk = createClient(endpoint, async (action, op, type, vars) => {
    try {
      return await withAuth(action, op, type, vars);
    } catch (err) {
      notifyRequestError(err);
      throw err;
    }
  });
  return new GraphQLReactorClient({
    url: endpoint,
    graphqlClient: sdk,
    documentModels: VAULT_DOCUMENT_MODELS,
  });
}
```

Remove the now-duplicated `const previousClient`/`previousCache` lines that preceded the old block (they are declared once, above the `hostClient` line). `restore()` is unchanged: it puts `previousClient` back, which under the host is the same client.

- [ ] **Step 4: Run the tests**

Run: `bun run vitest run editors/knowledge-vault/lib/remote-first.test.ts editors/knowledge-vault/lib/boot.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add editors/knowledge-vault/lib/remote-first.ts editors/knowledge-vault/lib/remote-first.test.ts
git commit -m "feat(remote-first): reuse a host-provided GraphQL reactor client

The desktop host installs a GraphQLReactorClient before the vault app
mounts. enableRemoteFirst now adopts it instead of building a second
client and proxying one through the other; the vault document cache is
installed as before. Connect's worker-client path is unchanged.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 5: Package quality gate and build for the host

**Files:** none new.

- [ ] **Step 1: Run the package's full gate**

Run: `bun run tsc && bun run lint:fix && bun run test`
Expected: tsc clean; lint clean; every test passes (the suite was 2,117 green before this work).

- [ ] **Step 2: Build the distributable the host will link**

Run: `bun run build`
Expected: `dist/browser/editors/…`, `dist/browser/index.js`, `dist/node/…` refreshed; `[runtime-assets] models/ → dist/node/models` printed.

- [ ] **Step 3: Confirm the host-facing exports exist**

Run: `node -e 'const p=require("./package.json"); for (const k of [".","./editors","./document-models","./manifest","./style.css"]) console.log(k, p.exports[k] ? "ok" : "MISSING")'`
Expected: five `ok` lines.

- [ ] **Step 4: Commit any lint fix-ups**

```bash
git add -A
git commit -m "chore: lint fix-ups for desktop host mode

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" || echo "nothing to commit"
```

---

## Part B — desktop repository (`/home/beast/Documents/Powerhouse/desktop-knowledge-vault`, branch `dev`)

### Task 6: Workspace scaffold and stack-version guard

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `scripts/lib/stack-versions.mjs`, `scripts/check-stack-versions.mjs`, `README.md`
- Test: `scripts/lib/stack-versions.test.mjs`
- Modify: `.gitignore` (append `.dev-data/`)

**Interfaces:**
- Produces: `checkStackVersions(manifests: Array<{ name: string; deps: Record<string, string> }>, expected: string): string[]` (returns violation messages; empty = ok). Scripts: `bun run tsc`, `bun run test`, `bun run stack:check`, `bun run dev` (added in Task 9), `bun run dev:host`, `bun run dev:sidecar`.

- [ ] **Step 1: Write the failing test**

```js
// scripts/lib/stack-versions.test.mjs
import { describe, expect, it } from "vitest";
import { checkStackVersions } from "./stack-versions.mjs";

describe("checkStackVersions", () => {
  it("accepts a workspace where every stack package is pinned to the expected version", () => {
    const out = checkStackVersions(
      [
        { name: "sidecar", deps: { "@powerhousedao/switchboard": "6.2.3-dev.44", "document-model": "6.2.3-dev.44" } },
        { name: "host", deps: { "@powerhousedao/reactor-browser": "6.2.3-dev.44", react: "19.2.6" } },
      ],
      "6.2.3-dev.44",
    );
    expect(out).toEqual([]);
  });

  it("ignores the file-linked vault package and document-engineering", () => {
    const out = checkStackVersions(
      [{ name: "host", deps: { "@powerhousedao/knowledge-note": "file:../../bai-knowledge-note", "@powerhousedao/document-engineering": "1.40.5" } }],
      "6.2.3-dev.44",
    );
    expect(out).toEqual([]);
  });

  it("names every mismatch with its workspace and package", () => {
    const out = checkStackVersions(
      [{ name: "sidecar", deps: { "@powerhousedao/switchboard": "6.2.3-dev.43" } }],
      "6.2.3-dev.44",
    );
    expect(out).toEqual(["sidecar: @powerhousedao/switchboard is 6.2.3-dev.43, expected 6.2.3-dev.44"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun install && bun run vitest run scripts/lib/stack-versions.test.mjs`
(First create the root `package.json` from Step 3 so `vitest` exists, then run; expected FAIL: `checkStackVersions` not found.)

- [ ] **Step 3: Create the workspace files**

`package.json`:
```json
{
  "name": "desktop-knowledge-vault",
  "private": true,
  "version": "0.1.0",
  "workspaces": ["host", "sidecar"],
  "scripts": {
    "dev": "node scripts/dev.mjs",
    "dev:host": "bun run --cwd host dev",
    "dev:sidecar": "bun run --cwd sidecar dev",
    "dev:shell": "bunx @tauri-apps/cli dev",
    "build:host": "bun run --cwd host build",
    "build:sidecar": "bun run --cwd sidecar build",
    "tsc": "bun run --cwd sidecar tsc && bun run --cwd host tsc",
    "test": "vitest run",
    "stack:check": "node scripts/check-stack-versions.mjs",
    "e2e": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.63.0",
    "typescript": "^5.9.3",
    "vitest": "4.1.1"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true
  }
}
```

`vitest.config.ts` (root — runs every workspace's tests from one command):
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["scripts/**/*.test.mjs", "sidecar/src/**/*.test.ts", "host/src/**/*.test.{ts,tsx}"],
    // Host tests that need a DOM start with `// @vitest-environment jsdom`; the Phase 0 ones are pure.
  },
});
```

`scripts/lib/stack-versions.mjs`:
```js
// Every @powerhousedao/* package and document-model must share one stack version.
const EXEMPT = new Set(["@powerhousedao/knowledge-note", "@powerhousedao/document-engineering"]);
export function isStackPackage(name) {
  return (name.startsWith("@powerhousedao/") || name === "document-model") && !EXEMPT.has(name);
}
export function checkStackVersions(manifests, expected) {
  const out = [];
  for (const { name, deps } of manifests) {
    for (const [pkg, version] of Object.entries(deps)) {
      if (!isStackPackage(pkg)) continue;
      if (version !== expected) out.push(`${name}: ${pkg} is ${version}, expected ${expected}`);
    }
  }
  return out;
}
```

`scripts/check-stack-versions.mjs`:
```js
import { readFileSync } from "node:fs";
import { checkStackVersions } from "./lib/stack-versions.mjs";
const EXPECTED = "6.2.3-dev.44";
const manifests = ["host", "sidecar"].map((dir) => {
  const p = JSON.parse(readFileSync(new URL(`../${dir}/package.json`, import.meta.url), "utf8"));
  return { name: dir, deps: { ...p.dependencies, ...p.devDependencies } };
});
const problems = checkStackVersions(manifests, EXPECTED);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`stack ${EXPECTED} pinned in ${manifests.length} workspaces`);
```

`README.md`:
```markdown
# Desktop Knowledge Vault

A desktop app that runs a Powerhouse Knowledge Vault locally (Tauri shell + Node sidecar + web host).
Design: `docs/superpowers/specs/2026-10-06-desktop-knowledge-vault-design.md`.

## Develop
- `bun install`
- `bun run dev` — sidecar on 4201, host on 4200, Tauri window (`--no-shell` for browser-only)
- `bun run test`, `bun run tsc`, `bun run stack:check`
Requires the vault package checked out at `../bai-knowledge-note` and built (`bun run build` there).
```

Append to `.gitignore`: `.dev-data/`

- [ ] **Step 4: Run the test**

Run: `bun install && bun run vitest run scripts/lib/stack-versions.test.mjs`
Expected: PASS (3 tests). (`host/` and `sidecar/` do not exist yet; `check-stack-versions` runs in Task 8 Step 6.)

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.base.json vitest.config.ts scripts README.md .gitignore bun.lock
git commit -m "chore: bun workspace scaffold with a stack-version guard

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 7: Sidecar — Switchboard on plain data dirs, control API, vault list/create

**Files:**
- Create: `sidecar/package.json`, `sidecar/tsconfig.json`, `sidecar/src/config.ts`, `sidecar/src/secrets.ts`, `sidecar/src/ready.ts`, `sidecar/src/vaults.ts`, `sidecar/src/control.ts`, `sidecar/src/main.ts`, `sidecar/src/nodefs-shim.mjs`, `sidecar/src/nodefs-hooks.mjs`
- Test: `sidecar/src/config.test.ts`, `sidecar/src/ready.test.ts`, `sidecar/src/vaults.test.ts`, `sidecar/src/control.test.ts`

**Interfaces:**
- Produces (used by Tasks 8–11):
  - Env contract from the shell: `KV_DATA_DIR`, `KV_PORT`, `KV_CONTROL_PORT`, `KV_CONTROL_TOKEN`, `KV_HOST_ORIGIN`, `KV_PROTECTED` (`"1"`/unset), `KV_ADMIN_ADDRESS`, `KV_APP_VERSION`.
  - `readSidecarConfig(env): SidecarConfig` and `switchboardEnv(cfg: SidecarConfig, workflowsKey: string): Record<string, string>`.
  - Readiness line on stdout: `{"event":"ready","port":<n>,"controlPort":<n>}`; stdin EOF → graceful shutdown.
  - Control API on `127.0.0.1:<controlPort>`, every request `Authorization: Bearer <token>`: `GET /status` → `{ ok: true, port, controlPort, appVersion, protected }`; `GET /vaults` → `{ vaults: VaultSummary[] }`; `POST /vaults {name}` → `201 { vault: VaultSummary }`; CORS for `KV_HOST_ORIGIN`.
  - `type VaultSummary = { id: string; slug: string; name: string; noteCount: number }`.

- [ ] **Step 1: Create `sidecar/package.json` and `sidecar/tsconfig.json`**

```json
{
  "name": "@desktop-knowledge-vault/sidecar",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json && cp src/*.mjs dist/",
    "dev": "bun run build && KV_DATA_DIR=../.dev-data KV_PORT=4201 KV_CONTROL_PORT=4202 KV_CONTROL_TOKEN=dev-token KV_HOST_ORIGIN=http://127.0.0.1:4200 node dist/main.js",
    "tsc": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@electric-sql/pglite": "0.3.15",
    "@powerhousedao/knowledge-note": "file:../../bai-knowledge-note",
    "@powerhousedao/switchboard": "6.2.3-dev.44",
    "@powerhousedao/workflow": "6.2.3-dev.44"
  },
  "devDependencies": {
    "@types/node": "^24.9.2",
    "typescript": "^5.9.3",
    "vitest": "4.1.1"
  }
}
```

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "types": ["node"], "lib": ["ES2022"] },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 2: Write the failing config test**

```ts
// sidecar/src/config.test.ts
import { describe, expect, it } from "vitest";
import { readSidecarConfig, switchboardEnv } from "./config.js";

const base = {
  KV_DATA_DIR: "/tmp/Knowledge Vault äö/data",
  KV_PORT: "4301",
  KV_CONTROL_PORT: "4302",
  KV_CONTROL_TOKEN: "t0k3n",
  KV_HOST_ORIGIN: "http://127.0.0.1:4300",
  KV_APP_VERSION: "0.1.0",
};

describe("readSidecarConfig", () => {
  it("reads the shell's variables and defaults protection to off", () => {
    const cfg = readSidecarConfig(base);
    expect(cfg).toEqual({
      dataDir: "/tmp/Knowledge Vault äö/data",
      port: 4301,
      controlPort: 4302,
      controlToken: "t0k3n",
      hostOrigin: "http://127.0.0.1:4300",
      protected: false,
      adminAddress: undefined,
      appVersion: "0.1.0",
    });
  });
  it("refuses to start without a data dir or token", () => {
    expect(() => readSidecarConfig({ ...base, KV_DATA_DIR: "" })).toThrow(/KV_DATA_DIR/);
    expect(() => readSidecarConfig({ ...base, KV_CONTROL_TOKEN: undefined })).toThrow(/KV_CONTROL_TOKEN/);
  });
});

describe("switchboardEnv", () => {
  it("builds the open-mode environment on the data dir, with telemetry unset", () => {
    const env = switchboardEnv(readSidecarConfig(base), "wfkey");
    expect(env.PORT).toBe("4301");
    expect(env.PH_REACTOR_DATABASE_URL).toBe("/tmp/Knowledge Vault äö/data/reactor");
    expect(env.DATABASE_URL).toBe("/tmp/Knowledge Vault äö/data/read-model");
    expect(env.PH_SWITCHBOARD_PUBLIC_URL).toBe("http://127.0.0.1:4301");
    expect(env.PUBLIC_URL).toBe("http://127.0.0.1:4301");
    expect(env.AUTH_ENABLED).toBe("false");
    expect(env.REQUIRE_AUTHENTICATED_CALLER).toBe("false");
    expect(env.DEFAULT_PROTECTION).toBe("false");
    expect(env.DOCUMENT_PERMISSIONS_ENABLED).toBe("false");
    expect(env.ADMINS).toBe("");
    expect(env.PH_WORKFLOWS_ENABLED).toBe("1");
    expect(env.PH_WORKFLOWS_SECRETS_MASTER_KEY).toBe("wfkey");
    expect(env.PH_WORKFLOWS_EGRESS_ALLOW_ADDRESSES).toBe("127.0.0.1/32,::1/128");
    expect(env.SWITCHBOARD_APP_NAME).toBe("desktop-knowledge-vault");
    expect(env.MCP_ENABLED).toBe("true");
    for (const k of ["SENTRY_DSN", "ENABLE_TRACING", "PYROSCOPE_SERVER_ADDRESS", "CONVERT_SERVICE_URL"]) {
      expect(k in env).toBe(false);
    }
  });
  it("turns the four auth flags on with the admin address in protected mode", () => {
    const env = switchboardEnv(
      readSidecarConfig({ ...base, KV_PROTECTED: "1", KV_ADMIN_ADDRESS: "0xabc" }),
      "wfkey",
    );
    expect(env.AUTH_ENABLED).toBe("true");
    expect(env.REQUIRE_AUTHENTICATED_CALLER).toBe("true");
    expect(env.DEFAULT_PROTECTION).toBe("true");
    expect(env.DOCUMENT_PERMISSIONS_ENABLED).toBe("true");
    expect(env.ADMINS).toBe("0xabc");
  });
  it("refuses protected mode without an admin address", () => {
    expect(() => readSidecarConfig({ ...base, KV_PROTECTED: "1" })).toThrow(/KV_ADMIN_ADDRESS/);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun install && bun run vitest run sidecar/src/config.test.ts`
Expected: FAIL — module `./config.js` not found.

- [ ] **Step 4: Implement `config.ts`**

```ts
// sidecar/src/config.ts
import { join } from "node:path";

export type SidecarConfig = {
  dataDir: string;
  port: number;
  controlPort: number;
  controlToken: string;
  hostOrigin: string;
  protected: boolean;
  adminAddress: string | undefined;
  appVersion: string;
};

type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`${key} is required`);
  return v;
}
function port(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${key} must be a port, got "${raw}"`);
  return n;
}

export function readSidecarConfig(env: Env): SidecarConfig {
  const isProtected = env.KV_PROTECTED === "1";
  const adminAddress = env.KV_ADMIN_ADDRESS || undefined;
  if (isProtected && !adminAddress) throw new Error("KV_ADMIN_ADDRESS is required when KV_PROTECTED=1");
  return {
    dataDir: required(env, "KV_DATA_DIR"),
    port: port(env, "KV_PORT", 4201),
    controlPort: port(env, "KV_CONTROL_PORT", 4202),
    controlToken: required(env, "KV_CONTROL_TOKEN"),
    hostOrigin: env.KV_HOST_ORIGIN || "http://127.0.0.1:4200",
    protected: isProtected,
    adminAddress,
    appVersion: env.KV_APP_VERSION || "dev",
  };
}

/** Spec §4.2: the environment the Switchboard is started with. Nothing else is inherited. */
export function switchboardEnv(cfg: SidecarConfig, workflowsMasterKey: string): Record<string, string> {
  const origin = `http://127.0.0.1:${cfg.port}`;
  const flag = cfg.protected ? "true" : "false";
  return {
    PORT: String(cfg.port),
    PH_REACTOR_DATABASE_URL: join(cfg.dataDir, "reactor"),
    DATABASE_URL: join(cfg.dataDir, "read-model"),
    PH_SWITCHBOARD_PUBLIC_URL: origin,
    PUBLIC_URL: origin,
    AUTH_ENABLED: flag,
    REQUIRE_AUTHENTICATED_CALLER: flag,
    DEFAULT_PROTECTION: flag,
    DOCUMENT_PERMISSIONS_ENABLED: flag,
    ADMINS: cfg.protected ? cfg.adminAddress ?? "" : "",
    PH_WORKFLOWS_ENABLED: "1",
    PH_WORKFLOWS_SECRETS_MASTER_KEY: workflowsMasterKey,
    PH_WORKFLOWS_EGRESS_ALLOW_ADDRESSES: "127.0.0.1/32,::1/128",
    SWITCHBOARD_APP_NAME: "desktop-knowledge-vault",
    MCP_ENABLED: "true",
    LOG_LEVEL: "info",
    NODE_ENV: "production",
  };
}
```

- [ ] **Step 5: Run the config test**

Run: `bun run vitest run sidecar/src/config.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Write the failing readiness tests**

```ts
// sidecar/src/ready.test.ts
import { describe, expect, it, vi } from "vitest";
import { readyLine, waitForHealth } from "./ready.js";

describe("readyLine", () => {
  it("is one JSON line the shell can parse", () => {
    expect(JSON.parse(readyLine(4201, 4202))).toEqual({ event: "ready", port: 4201, controlPort: 4202 });
    expect(readyLine(4201, 4202).includes("\n")).toBe(false);
  });
});

describe("waitForHealth", () => {
  it("resolves once /health answers 200", async () => {
    const codes = [503, 500, 200];
    const fetchImpl = vi.fn(async () => ({ ok: codes.shift() === 200 })) as unknown as typeof fetch;
    await waitForHealth("http://127.0.0.1:1/health", { timeoutMs: 1_000, intervalMs: 1, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it("rejects with the url when the deadline passes", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    await expect(
      waitForHealth("http://127.0.0.1:1/health", { timeoutMs: 20, intervalMs: 5, fetchImpl }),
    ).rejects.toThrow(/http:\/\/127\.0\.0\.1:1\/health/);
  });
});
```

- [ ] **Step 7: Implement `ready.ts`**

```ts
// sidecar/src/ready.ts
export function readyLine(port: number, controlPort: number): string {
  return JSON.stringify({ event: "ready", port, controlPort });
}

export async function waitForHealth(
  url: string,
  opts: { timeoutMs: number; intervalMs: number; fetchImpl?: typeof fetch },
): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    try {
      const res = await fetchImpl(url);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    if (Date.now() >= deadline) throw new Error(`Switchboard did not answer at ${url} within ${opts.timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, opts.intervalMs));
  }
}
```

Run: `bun run vitest run sidecar/src/ready.test.ts` → PASS (3 tests).

- [ ] **Step 8: Write the failing vaults tests**

```ts
// sidecar/src/vaults.test.ts
import { describe, expect, it, vi } from "vitest";
import { createVaultDrive, listVaultDrives, slugify } from "./vaults.js";

const ORIGIN = "http://127.0.0.1:4201";
type Call = { url: string; body?: unknown };

function fakeFetch(handler: (call: Call) => unknown): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    return { ok: true, status: 200, json: async () => handler(call) };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("slugify", () => {
  it("lowercases, hyphenates spaces and drops everything else", () => {
    expect(slugify("Research Notes (2026)!")).toBe("research-notes-2026");
  });
});

describe("listVaultDrives", () => {
  it("returns only drives whose preferredEditor is knowledge-vault, with a note count", async () => {
    const { fetchImpl } = fakeFetch(({ url }) => {
      if (url.endsWith("/graphql")) {
        return { data: { findDocuments: { items: [
          { id: "v1", name: "Research", slug: "research", state: { global: { nodes: [
            { kind: "file", documentType: "bai/knowledge-note" }, { kind: "file", documentType: "bai/knowledge-note" }, { kind: "folder" } ] } } },
          { id: "w1", name: "Workflows", slug: "workflows", state: { global: { nodes: [] } } },
        ] } } };
      }
      if (url.endsWith("/d/v1")) return { id: "v1", slug: "research", name: "Research", meta: { preferredEditor: "knowledge-vault" } };
      if (url.endsWith("/d/w1")) return { id: "w1", slug: "workflows", name: "Workflows", meta: { preferredEditor: "workflow-studio" } };
      throw new Error(`unexpected ${url}`);
    });
    const vaults = await listVaultDrives(ORIGIN, fetchImpl);
    expect(vaults).toEqual([{ id: "v1", slug: "research", name: "Research", noteCount: 2 }]);
  });
});

describe("createVaultDrive", () => {
  it("creates the drive with the vault app as preferred editor and sets the state name", async () => {
    const { fetchImpl, calls } = fakeFetch(({ body }) => {
      const q = String((body as { query: string }).query);
      if (q.includes("createDocument")) return { data: { DocumentDrive: { createDocument: { id: "v9", slug: "my-vault", name: "My vault" } } } };
      if (q.includes("setDriveName")) return { data: { DocumentDrive: { setDriveName: { id: "v9" } } } };
      throw new Error(`unexpected query ${q}`);
    });
    const vault = await createVaultDrive(ORIGIN, "My vault", fetchImpl);
    expect(vault).toEqual({ id: "v9", slug: "my-vault", name: "My vault", noteCount: 0 });
    expect((calls[0]!.body as { variables: unknown }).variables).toEqual({
      name: "My vault", slug: "my-vault", preferredEditor: "knowledge-vault",
    });
    expect((calls[1]!.body as { variables: unknown }).variables).toEqual({ docId: "v9", input: { name: "My vault" } });
  });
  it("surfaces GraphQL errors instead of returning a half-made vault", async () => {
    const { fetchImpl } = fakeFetch(() => ({ errors: [{ message: "Forbidden" }] }));
    await expect(createVaultDrive(ORIGIN, "X", fetchImpl)).rejects.toThrow(/Forbidden/);
  });
});
```

- [ ] **Step 9: Implement `vaults.ts`**

```ts
// sidecar/src/vaults.ts
export type VaultSummary = { id: string; slug: string; name: string; noteCount: number };
export const VAULT_APP_ID = "knowledge-vault";

export function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

async function gql<T>(origin: string, query: string, variables: Record<string, unknown>, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(`${origin}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Switchboard answered HTTP ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  if (!json.data) throw new Error("Switchboard answered without data");
  return json.data;
}

type DriveItem = { id: string; name: string; slug: string; state?: { global?: { nodes?: { kind?: string; documentType?: string }[] } } };
type DriveInfo = { id: string; slug: string; name: string; meta?: { preferredEditor?: string } };

function countNotes(item: DriveItem): number {
  return (item.state?.global?.nodes ?? []).filter((n) => n.kind === "file" && n.documentType === "bai/knowledge-note").length;
}

export async function listVaultDrives(origin: string, fetchImpl: typeof fetch = fetch): Promise<VaultSummary[]> {
  const data = await gql<{ findDocuments: { items: DriveItem[] } }>(
    origin,
    `{ findDocuments(search: { type: "powerhouse/document-drive" }) { items { id name slug state } } }`,
    {},
    fetchImpl,
  );
  const out: VaultSummary[] = [];
  for (const item of data.findDocuments.items) {
    const res = await fetchImpl(`${origin}/d/${encodeURIComponent(item.id)}`);
    if (!res.ok) continue;
    const info = (await res.json()) as DriveInfo;
    if (info.meta?.preferredEditor !== VAULT_APP_ID) continue;
    out.push({ id: item.id, slug: info.slug || item.slug, name: info.name || item.name, noteCount: countNotes(item) });
  }
  return out;
}

/** The same two mutations `switchboard drives create --preferred-editor knowledge-vault` runs. */
export async function createVaultDrive(origin: string, name: string, fetchImpl: typeof fetch = fetch): Promise<VaultSummary> {
  const slug = slugify(name) || "vault";
  const created = await gql<{ DocumentDrive: { createDocument: { id: string; slug: string; name: string } } }>(
    origin,
    `mutation($name: String!, $slug: String, $preferredEditor: String) { DocumentDrive { createDocument(name: $name, slug: $slug, preferredEditor: $preferredEditor) { id slug name } } }`,
    { name, slug, preferredEditor: VAULT_APP_ID },
    fetchImpl,
  );
  const drive = created.DocumentDrive.createDocument;
  // createDocument sets only the header name; the UI and /d/<id> read state.global.name.
  await gql(
    origin,
    `mutation($docId: PHID!, $input: DocumentDrive_SetDriveNameInput!) { DocumentDrive { setDriveName(docId: $docId, input: $input) { id } } }`,
    { docId: drive.id, input: { name } },
    fetchImpl,
  );
  return { id: drive.id, slug: drive.slug, name, noteCount: 0 };
}
```

Run: `bun run vitest run sidecar/src/vaults.test.ts` → PASS (4 tests).

- [ ] **Step 10: Write the failing control API test**

```ts
// sidecar/src/control.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { createControlServer } from "./control.js";
import type { VaultSummary } from "./vaults.js";

const vaults: VaultSummary[] = [{ id: "v1", slug: "research", name: "Research", noteCount: 2 }];
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });

async function start() {
  const server = createControlServer({
    token: "secret",
    hostOrigin: "http://127.0.0.1:4200",
    status: () => ({ ok: true, port: 4201, controlPort: 0, appVersion: "0.1.0", protected: false }),
    listVaults: async () => vaults,
    createVault: async (name) => ({ id: "v2", slug: "n", name, noteCount: 0 }),
  });
  const port = await server.listen();
  close = server.close;
  return `http://127.0.0.1:${port}`;
}

describe("control API", () => {
  it("rejects a missing or wrong token", async () => {
    const base = await start();
    expect((await fetch(`${base}/status`)).status).toBe(401);
    expect((await fetch(`${base}/status`, { headers: { authorization: "Bearer nope" } })).status).toBe(401);
  });
  it("answers status, lists and creates vaults with the token", async () => {
    const base = await start();
    const h = { authorization: "Bearer secret", "content-type": "application/json" };
    expect(await (await fetch(`${base}/status`, { headers: h })).json()).toMatchObject({ ok: true, port: 4201 });
    expect(await (await fetch(`${base}/vaults`, { headers: h })).json()).toEqual({ vaults });
    const created = await fetch(`${base}/vaults`, { method: "POST", headers: h, body: JSON.stringify({ name: "New" }) });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ vault: { id: "v2", slug: "n", name: "New", noteCount: 0 } });
  });
  it("rejects a vault without a name", async () => {
    const base = await start();
    const res = await fetch(`${base}/vaults`, { method: "POST", headers: { authorization: "Bearer secret", "content-type": "application/json" }, body: JSON.stringify({ name: "  " }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "A vault needs a name." });
  });
  it("answers CORS preflight for the host origin only", async () => {
    const base = await start();
    const ok = await fetch(`${base}/vaults`, { method: "OPTIONS", headers: { origin: "http://127.0.0.1:4200", "access-control-request-method": "POST" } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:4200");
    const other = await fetch(`${base}/vaults`, { method: "OPTIONS", headers: { origin: "http://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});
```

- [ ] **Step 11: Implement `control.ts`**

```ts
// sidecar/src/control.ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { VaultSummary } from "./vaults.js";

export type StatusPayload = { ok: true; port: number; controlPort: number; appVersion: string; protected: boolean };
export type ControlDeps = {
  token: string;
  hostOrigin: string;
  status: () => StatusPayload;
  listVaults: () => Promise<VaultSummary[]>;
  createVault: (name: string) => Promise<VaultSummary>;
};

function send(res: ServerResponse, status: number, body: unknown, origin?: string): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  if (origin) res.setHeader("access-control-allow-origin", origin);
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

export function createControlServer(deps: ControlDeps) {
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const allowed = origin === deps.hostOrigin ? origin : undefined;
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      if (allowed) {
        res.setHeader("access-control-allow-origin", allowed);
        res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
        res.setHeader("access-control-allow-headers", "authorization,content-type");
      }
      res.end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${deps.token}`) return send(res, 401, { error: "Unauthorized" }, allowed);
    const url = new URL(req.url ?? "/", "http://control");
    try {
      if (req.method === "GET" && url.pathname === "/status") return send(res, 200, deps.status(), allowed);
      if (req.method === "GET" && url.pathname === "/vaults") return send(res, 200, { vaults: await deps.listVaults() }, allowed);
      if (req.method === "POST" && url.pathname === "/vaults") {
        const body = await readJson(req);
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name) return send(res, 400, { error: "A vault needs a name." }, allowed);
        return send(res, 201, { vault: await deps.createVault(name) }, allowed);
      }
      return send(res, 404, { error: "Not found" }, allowed);
    } catch (error) {
      return send(res, 500, { error: error instanceof Error ? error.message : String(error) }, allowed);
    }
  });
  return {
    /** Bind on loopback; `port` 0 picks a free one. Resolves the bound port. */
    listen(port = 0): Promise<number> {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          const addr = server.address();
          resolve(typeof addr === "object" && addr ? addr.port : port);
        });
      });
    },
    close(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
```

Run: `bun run vitest run sidecar/src/control.test.ts` → PASS (4 tests).

- [ ] **Step 12: Add `secrets.ts`, the NodeFS shim and `main.ts`**

```ts
// sidecar/src/secrets.ts
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Read a secret file or create it (32 random bytes, hex) with mode 0600. */
export function ensureSecret(path: string): string {
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const value = randomBytes(32).toString("hex");
  writeFileSync(path, value, { mode: 0o600 });
  chmodSync(path, 0o600);
  return value;
}
```

```js
// sidecar/src/nodefs-shim.mjs
// The Switchboard constructs PGlite with @powerhousedao/pglite-fs's AtomicNodeFs
// (whole database in memory, single-file snapshot). On a desktop that costs
// ~3.7 GB RSS for a 1 GB store; PGlite's plain NodeFS keeps the data on disk
// and measured 829 MB. Same class name so the Switchboard needs no change.
import { NodeFS } from "@electric-sql/pglite/nodefs";
export class AtomicNodeFs extends NodeFS {
  constructor(dir, _options) {
    super(dir);
  }
}
```

```js
// sidecar/src/nodefs-hooks.mjs
export async function resolve(specifier, context, next) {
  if (specifier === "@powerhousedao/pglite-fs") {
    return { url: new URL("./nodefs-shim.mjs", import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
```

```ts
// sidecar/src/main.ts
import { mkdirSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { readSidecarConfig, switchboardEnv } from "./config.js";
import { createControlServer } from "./control.js";
import { readyLine, waitForHealth } from "./ready.js";
import { ensureSecret } from "./secrets.js";
import { createVaultDrive, listVaultDrives } from "./vaults.js";

// The data-dir storage swap must be registered before the Switchboard (and
// through it @powerhousedao/pglite-fs) is imported — hence the dynamic import below.
register(new URL("./nodefs-hooks.mjs", import.meta.url));

async function main(): Promise<void> {
  const cfg = readSidecarConfig(process.env);
  cfg.dataDir = resolve(cfg.dataDir); // relative values (the dev loop's ../.dev-data) resolve against cwd = sidecar/
  for (const sub of ["reactor", "read-model", "attachments", "secrets", "logs"]) {
    mkdirSync(join(cfg.dataDir, sub), { recursive: true });
  }
  const workflowsKey = ensureSecret(join(cfg.dataDir, "secrets", "workflows.key"));
  Object.assign(process.env, switchboardEnv(cfg, workflowsKey));
  // cwd stays sidecar/ (the shell and the dev loop spawn us there): package
  // names resolve through the workspace's node_modules, and the config file is
  // named explicitly so nothing depends on what else cwd contains.
  const configFile = fileURLToPath(new URL("../powerhouse.config.json", import.meta.url));

  const { startSwitchboard } = await import("@powerhousedao/switchboard/server");
  const switchboard = await startSwitchboard({
    configFile,
    port: cfg.port,
    strictPort: true,
    dev: false,
    mcp: true,
    workflows: { enabled: true },
    packages: ["@powerhousedao/knowledge-note", "@powerhousedao/workflow"],
    disableLocalPackages: true,
    remoteDrives: [],
    fatalErrorShutdown: true,
  });
  const origin = `http://127.0.0.1:${switchboard.port}`;
  await waitForHealth(`${origin}/health`, { timeoutMs: 60_000, intervalMs: 250 });

  const control = createControlServer({
    token: cfg.controlToken,
    hostOrigin: cfg.hostOrigin,
    status: () => ({ ok: true, port: switchboard.port, controlPort: cfg.controlPort, appVersion: cfg.appVersion, protected: cfg.protected }),
    listVaults: () => listVaultDrives(origin),
    createVault: (name) => createVaultDrive(origin, name),
  });
  const controlPort = await control.listen(cfg.controlPort);
  process.stdout.write(readyLine(switchboard.port, controlPort) + "\n");

  // The shell closes our stdin to ask for a graceful stop; SIGINT runs the
  // Switchboard's own shutdown (PGlite flush, drained API).
  process.stdin.resume();
  process.stdin.on("end", () => process.kill(process.pid, "SIGINT"));
  process.stdin.on("data", (chunk) => {
    if (String(chunk).trim() === "stop") process.kill(process.pid, "SIGINT");
  });
  process.on("SIGINT", () => void control.close());
}

main().catch((error) => {
  console.error(`[sidecar] failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
```

Also create `sidecar/powerhouse.config.json` — the Switchboard reads one from `configFile`; this keeps it independent of cwd:
```json
{ "packages": [], "workflows": { "enabled": true }, "reactor": { "port": 4201 } }
```
The sidecar is always spawned with **cwd = `sidecar/`** (the dev loop in Task 9 and the shell in Task 10 both do this), so `@powerhousedao/knowledge-note` and `@powerhousedao/workflow` resolve through the workspace's hoisted `node_modules`, and `disableLocalPackages: true` stops the Switchboard from treating `sidecar/` itself as a package.

- [ ] **Step 13: Type-check, build and boot the sidecar once by hand**

Run: `bun run --cwd sidecar tsc && bun run --cwd sidecar build && bun run stack:check`
Expected: clean; `stack 6.2.3-dev.44 pinned in 2 workspaces` prints after Task 8 adds `host/` (until then the script exits 1 on the missing `host/package.json` — acceptable; re-run in Task 8).

Run (from the repo root, 90 s budget): `bun run dev:sidecar`
Expected: Switchboard logs, then exactly one line `{"event":"ready","port":4201,"controlPort":4202}`; `curl -s -H 'authorization: Bearer dev-token' http://127.0.0.1:4202/status` → `{"ok":true,"port":4201,…}`; `curl -s -X POST -H 'authorization: Bearer dev-token' -H 'content-type: application/json' -d '{"name":"Research notes"}' http://127.0.0.1:4202/vaults` → `201` with the vault; `curl -s http://127.0.0.1:4201/d/<id>` shows `"preferredEditor":"knowledge-vault"`. Stop with Ctrl+C; `.dev-data/reactor/PG_VERSION` exists (plain data dir, no `snapshot.bin`).

- [ ] **Step 14: Commit**

```bash
git add sidecar bun.lock
git commit -m "feat(sidecar): Switchboard on plain PGlite data dirs with a loopback control API

startSwitchboard with the vault and workflow packages, env built from the
shell's KV_* variables (open/protected matrix), PGlite NodeFS swapped in
through a loader hook, readiness line on stdout, stdin EOF as the
graceful-stop signal, and a token-protected control API that lists and
creates vault drives with the same mutations the CLI uses.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 8: Host — the vault app mounted against the sidecar (browser mode)

**Files:**
- Create: `host/package.json`, `host/tsconfig.json`, `host/vite.config.ts`, `host/index.html`, `host/src/main.tsx`, `host/src/bootstrap.ts`, `host/src/sidecar.ts`, `host/src/reactor.ts`, `host/src/vaults.ts`, `host/src/App.tsx`, `host/src/screens/Landing.tsx`, `host/src/screens/VaultScreen.tsx`, `host/src/components/DocumentEditorContainer.tsx`, `host/src/host.css`, `host/src/vite-env.d.ts`
- Test: `host/src/bootstrap.test.ts`, `host/src/sidecar.test.ts`, `host/src/vaults.test.ts`

**Interfaces:**
- Consumes: control API and readiness contract (Task 7); `__knowledgeVaultHost` slot (Task 1); `reactor-browser` exports `ensurePHEventHandlers, GraphQLReactorClient, DocumentCache, setReactorClient, setDocumentCache, StaticPackageManager, setVetraPackageManager, setDrives, setSelectedDrive, setSelectedNode, useSelectedDriveSafe, useSelectedDocumentId, useSelectedDocument, useAppModuleById, useEditorModuleById, useEditorModulesForDocumentType, useSwitchboardClient, RenownProvider`.
- Produces: `declareDesktopHost(origin: string): void`; `sidecarOrigins(port: number, controlPort: number): { origin: string; graphqlUrl: string; controlOrigin: string }`; `resolveSidecar(): Promise<SidecarInfo>` where `type SidecarInfo = { origin: string; graphqlUrl: string; controlOrigin: string; controlToken: string }`; `installReactor(info: SidecarInfo, libs: DocumentModelLib[]): GraphQLReactorClient`; `fetchVaults(info): Promise<VaultSummary[]>`, `createVault(info, name): Promise<VaultSummary>`.

- [ ] **Step 1: Create `host/package.json`, `host/tsconfig.json`, `host/vite.config.ts`, `host/index.html`, `host/src/vite-env.d.ts`**

```json
{
  "name": "@desktop-knowledge-vault/host",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 4200 --strictPort",
    "build": "tsc -p tsconfig.json --noEmit && vite build",
    "tsc": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@powerhousedao/design-system": "6.2.3-dev.44",
    "@powerhousedao/knowledge-note": "file:../../bai-knowledge-note",
    "@powerhousedao/reactor-browser": "6.2.3-dev.44",
    "@powerhousedao/workflow": "6.2.3-dev.44",
    "@tauri-apps/api": "^2.9.0",
    "document-model": "6.2.3-dev.44",
    "react": "19.2.6",
    "react-dom": "19.2.6"
  },
  "devDependencies": {
    "@testing-library/react": "^16.3.0",
    "@types/react": "^19.2.3",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.1",
    "jsdom": "^26.1.0",
    "typescript": "^5.9.3",
    "vite": "^8.0.10",
    "vitest": "4.1.1"
  }
}
```

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "noEmit": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts"]
}
```

```ts
// host/vite.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [react()],
  server: { port: 4200, strictPort: true, host: "127.0.0.1" },
  // One copy each: a second reactor-browser would not see the same window.ph brands.
  resolve: { dedupe: ["react", "react-dom", "@powerhousedao/reactor-browser", "document-model"] },
});
```

```html
<!-- host/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Knowledge Vault</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```ts
// host/src/vite-env.d.ts
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SIDECAR_PORT?: string;
  readonly VITE_CONTROL_PORT?: string;
  readonly VITE_CONTROL_TOKEN?: string;
}
```

- [ ] **Step 2: Write the failing tests for `bootstrap`, `sidecar` and `vaults`**

```ts
// host/src/bootstrap.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { declareDesktopHost, HOST_SLOT } from "./bootstrap.js";

afterEach(() => { delete (globalThis as Record<string, unknown>)[HOST_SLOT]; });

describe("declareDesktopHost", () => {
  it("writes the slot the vault package reads, before the package is loaded", () => {
    declareDesktopHost("http://127.0.0.1:4201");
    expect((globalThis as Record<string, unknown>)[HOST_SLOT]).toEqual({
      kind: "desktop",
      switchboardOrigin: "http://127.0.0.1:4201",
    });
  });
  it("re-declares when the vault changes (remote vaults later)", () => {
    declareDesktopHost("http://127.0.0.1:4201");
    declareDesktopHost("https://switchboard.knowledge-vault.vetra.io");
    expect((globalThis as Record<string, { switchboardOrigin: string }>)[HOST_SLOT]!.switchboardOrigin)
      .toBe("https://switchboard.knowledge-vault.vetra.io");
  });
});
```

```ts
// host/src/sidecar.test.ts
import { describe, expect, it } from "vitest";
import { sidecarOrigins } from "./sidecar.js";

describe("sidecarOrigins", () => {
  it("derives every URL from the ports the sidecar reported, not from defaults", () => {
    expect(sidecarOrigins(4307, 4308)).toEqual({
      origin: "http://127.0.0.1:4307",
      graphqlUrl: "http://127.0.0.1:4307/graphql",
      controlOrigin: "http://127.0.0.1:4308",
    });
  });
});
```

```ts
// host/src/vaults.test.ts
import { describe, expect, it, vi } from "vitest";
import { createVault, fetchVaults } from "./vaults.js";

const info = { origin: "http://127.0.0.1:4201", graphqlUrl: "http://127.0.0.1:4201/graphql", controlOrigin: "http://127.0.0.1:4202", controlToken: "secret" };

describe("vault list / create over the control API", () => {
  it("sends the token and unwraps the list", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ vaults: [{ id: "v1", slug: "s", name: "Research", noteCount: 3 }] }) })) as unknown as typeof fetch;
    const vaults = await fetchVaults(info, fetchImpl);
    expect(vaults).toEqual([{ id: "v1", slug: "s", name: "Research", noteCount: 3 }]);
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:4202/vaults");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret");
  });
  it("reports the engine's error message when creation fails", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: "Forbidden" }) })) as unknown as typeof fetch;
    await expect(createVault(info, "X", fetchImpl)).rejects.toThrow("Forbidden");
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `bun install && bun run vitest run host/src`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `bootstrap.ts`, `sidecar.ts`, `vaults.ts`, `reactor.ts`**

```ts
// host/src/bootstrap.ts
/** The slot `editors/shared/host-config.ts` in the vault package reads at call time. */
export const HOST_SLOT = "__knowledgeVaultHost";
export function declareDesktopHost(switchboardOrigin: string): void {
  (globalThis as Record<string, unknown>)[HOST_SLOT] = { kind: "desktop", switchboardOrigin };
}
```

```ts
// host/src/sidecar.ts
export type SidecarInfo = { origin: string; graphqlUrl: string; controlOrigin: string; controlToken: string };

export function sidecarOrigins(port: number, controlPort: number) {
  const origin = `http://127.0.0.1:${port}`;
  return { origin, graphqlUrl: `${origin}/graphql`, controlOrigin: `http://127.0.0.1:${controlPort}` };
}

type TauriReady = { port: number; controlPort: number; controlToken: string } | null;
const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Under Tauri: ask the shell (it answers once the sidecar printed its readiness line). In a browser: Vite env. */
export async function resolveSidecar(): Promise<SidecarInfo> {
  if (inTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    for (;;) {
      const ready = await invoke<TauriReady>("sidecar_info");
      if (ready) return { ...sidecarOrigins(ready.port, ready.controlPort), controlToken: ready.controlToken };
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  const port = Number(import.meta.env.VITE_SIDECAR_PORT ?? 4201);
  const controlPort = Number(import.meta.env.VITE_CONTROL_PORT ?? 4202);
  return { ...sidecarOrigins(port, controlPort), controlToken: import.meta.env.VITE_CONTROL_TOKEN ?? "dev-token" };
}
```

```ts
// host/src/vaults.ts
import type { SidecarInfo } from "./sidecar.js";
export type VaultSummary = { id: string; slug: string; name: string; noteCount: number };

async function control<T>(info: SidecarInfo, path: string, init: RequestInit, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(`${info.controlOrigin}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${info.controlToken}`, "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) },
  });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `The engine answered HTTP ${res.status}`);
  return body;
}
export async function fetchVaults(info: SidecarInfo, fetchImpl: typeof fetch = fetch): Promise<VaultSummary[]> {
  return (await control<{ vaults: VaultSummary[] }>(info, "/vaults", { method: "GET" }, fetchImpl)).vaults;
}
export async function createVault(info: SidecarInfo, name: string, fetchImpl: typeof fetch = fetch): Promise<VaultSummary> {
  return (await control<{ vault: VaultSummary }>(info, "/vaults", { method: "POST", body: JSON.stringify({ name }) }, fetchImpl)).vault;
}
```

```ts
// host/src/reactor.ts
import {
  DocumentCache,
  ensurePHEventHandlers,
  GraphQLReactorClient,
  setDocumentCache,
  setReactorClient,
  setVetraPackageManager,
  StaticPackageManager,
} from "@powerhousedao/reactor-browser";
import type { DocumentModelLib } from "document-model";
import type { SidecarInfo } from "./sidecar.js";

/**
 * What Connect's boot does for us, minus the in-browser reactor: one
 * Switchboard-backed client (with every document model, so multi-action
 * batches can be signed), a document cache over it, and a package manager
 * holding the vault and workflow packages — editors included, which is why
 * GraphQLReactorProvider (models only) is not used here.
 */
export function installReactor(info: SidecarInfo, libs: readonly DocumentModelLib[]): GraphQLReactorClient {
  ensurePHEventHandlers();
  const documentModels = libs.flatMap((lib) => [...lib.documentModels]);
  const client = new GraphQLReactorClient({ url: info.graphqlUrl, documentModels });
  setReactorClient(client);
  setDocumentCache(new DocumentCache(client));
  setVetraPackageManager(new StaticPackageManager(libs));
  return client;
}
```

- [ ] **Step 5: Implement the screens and `main.tsx`**

```tsx
// host/src/main.tsx
import { declareDesktopHost } from "./bootstrap.js";
import { resolveSidecar } from "./sidecar.js";
import "@powerhousedao/design-system/style.css";
import "@powerhousedao/knowledge-note/style.css";
import "@powerhousedao/workflow/style.css";
import "./host.css";

// Order matters: the vault package runs its package-load boot on import and
// reads the host slot at that moment, so declare before importing anything
// that imports the package (App does).
const info = await resolveSidecar();
declareDesktopHost(info.origin);
const [{ createRoot }, { StrictMode, createElement }, { App }] = await Promise.all([
  import("react-dom/client"),
  import("react"),
  import("./App.js"),
]);
createRoot(document.getElementById("root")!).render(createElement(StrictMode, null, createElement(App, { info })));
```

```tsx
// host/src/App.tsx
import { RenownProvider } from "@powerhousedao/reactor-browser";
import * as knowledgeNote from "@powerhousedao/knowledge-note";
import * as workflow from "@powerhousedao/workflow";
import type { DocumentModelLib } from "document-model";
import { useMemo, useState } from "react";
import { installReactor } from "./reactor.js";
import { Landing } from "./screens/Landing.js";
import { VaultScreen } from "./screens/VaultScreen.js";
import type { SidecarInfo } from "./sidecar.js";

const LIBS: readonly DocumentModelLib[] = [knowledgeNote as unknown as DocumentModelLib, workflow as unknown as DocumentModelLib];
type Route = { name: "landing" } | { name: "vault"; id: string; title: string };

export function App({ info }: { info: SidecarInfo }) {
  const client = useMemo(() => installReactor(info, LIBS), [info]);
  const [route, setRoute] = useState<Route>({ name: "landing" });
  return (
    <RenownProvider appName="desktop-knowledge-vault" url="https://www.renown.id" switchboardUrl={info.origin}>
      {route.name === "landing" ? (
        <Landing info={info} onOpen={(v) => setRoute({ name: "vault", id: v.id, title: v.name })} />
      ) : (
        <VaultScreen client={client} driveId={route.id} title={route.title} onBack={() => setRoute({ name: "landing" })} />
      )}
    </RenownProvider>
  );
}
```

```tsx
// host/src/screens/Landing.tsx  (Phase 0 skeleton; the designed landing of spec §5.7 is Phase 1)
import { useEffect, useState } from "react";
import type { SidecarInfo } from "../sidecar.js";
import { createVault, fetchVaults, type VaultSummary } from "../vaults.js";

export function Landing({ info, onOpen }: { info: SidecarInfo; onOpen: (v: VaultSummary) => void }) {
  const [vaults, setVaults] = useState<VaultSummary[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reload = () => fetchVaults(info).then(setVaults).catch((e: Error) => setError(e.message));
  useEffect(() => { void reload(); }, [info]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      const v = await createVault(info, name);
      setName("");
      onOpen(v);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="kv-landing">
      <header><h1>Knowledge Vault</h1></header>
      <section aria-labelledby="vaults-heading">
        <h2 id="vaults-heading">Vaults</h2>
        {vaults === null && !error && <p role="status">Starting the engine…</p>}
        {error && <p role="alert">{error}</p>}
        {vaults && vaults.length === 0 && <p>No vaults yet. Create your first vault below.</p>}
        <ul className="kv-vaults">
          {vaults?.map((v) => (
            <li key={v.id}>
              <button type="button" onClick={() => onOpen(v)}>
                <span className="kv-vault-name">{v.name}</span>
                <span className="kv-vault-meta">{v.noteCount} notes</span>
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={onCreate} className="kv-new-vault">
          <label htmlFor="vault-name">Name</label>
          <input id="vault-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Research notes" autoFocus />
          <button type="submit" disabled={!name.trim()}>Create vault</button>
        </form>
      </section>
    </main>
  );
}
```

```tsx
// host/src/screens/VaultScreen.tsx
import {
  setDrives,
  setSelectedDrive,
  setSelectedNode,
  useAppModuleById,
  useSelectedDocumentId,
  useSelectedDriveSafe,
  type GraphQLReactorClient,
} from "@powerhousedao/reactor-browser";
import { Suspense, useEffect, useState } from "react";
import { DocumentEditorContainer } from "../components/DocumentEditorContainer.js";

type Drives = NonNullable<Parameters<typeof setDrives>[0]>;
type DriveDoc = Drives[number];

export function VaultScreen(props: { client: GraphQLReactorClient; driveId: string; title: string; onBack: () => void }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    props.client.get<DriveDoc>(props.driveId).then((drive) => {
      if (cancelled) return;
      setDrives([drive]);
      setSelectedDrive(drive.header.id);
      setReady(true);
    }).catch((e: Error) => setError(e.message));
    return () => {
      cancelled = true;
      setSelectedNode(undefined);
      setSelectedDrive(undefined);
      setDrives([]);
    };
  }, [props.client, props.driveId]);

  return (
    <div className="kv-vault-screen">
      <nav className="kv-appbar">
        <button type="button" onClick={props.onBack}>← Vaults</button>
        <span className="kv-appbar-title">{props.title}</span>
      </nav>
      {error && <p role="alert">Could not open this vault: {error}</p>}
      {ready ? <AppContainer /> : !error && <p role="status">Opening…</p>}
    </div>
  );
}

/** Connect's AppContainer, reduced: the drive app renders, with the selected document's editor as its children. */
function AppContainer() {
  const [selectedDrive] = useSelectedDriveSafe();
  const selectedDocumentId = useSelectedDocumentId();
  const app = useAppModuleById(selectedDrive?.header.meta?.preferredEditor);
  if (!selectedDrive) return <p role="status">Opening…</p>;
  if (!app) return <p role="alert">This drive has no app to show it with.</p>;
  const AppComponent = app.Component;
  return (
    <Suspense fallback={<p role="status">Loading the vault…</p>}>
      <div className="kv-app">
        <AppComponent>{selectedDocumentId ? <DocumentEditorContainer /> : null}</AppComponent>
      </div>
    </Suspense>
  );
}
```

```tsx
// host/src/components/DocumentEditorContainer.tsx
import { useEditorModuleById, useEditorModulesForDocumentType, useSelectedDocument } from "@powerhousedao/reactor-browser";
import { Suspense } from "react";

/** Connect's DocumentEditor, reduced to module selection; the editors render their own DocumentToolbar. */
export function DocumentEditorContainer() {
  const [document] = useSelectedDocument();
  const preferred = useEditorModuleById(document.header.meta?.preferredEditor);
  const byType = useEditorModulesForDocumentType(document.header.documentType);
  const editor = preferred ?? byType?.[0];
  if (!editor) return <p role="alert">No editor is installed for {document.header.documentType}.</p>;
  const Editor = editor.Component;
  return (
    <div id="document-editor-container" className="flex-1" data-document-type={document.header.documentType}>
      <Suspense fallback={<p role="status">Loading…</p>}>
        <Editor key={document.header.id} document={document} />
      </Suspense>
    </div>
  );
}
```

```css
/* host/src/host.css — Phase 0 chrome only; the designed landing arrives in Phase 1 */
:root { font-family: Inter, system-ui, sans-serif; color: #1C2128; background: #F7F8F6; }
body, #root { margin: 0; height: 100vh; }
.kv-landing { max-width: 1040px; margin: 0 auto; padding: 32px 24px; }
.kv-vaults { list-style: none; padding: 0; display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.kv-vaults button { width: 100%; text-align: left; padding: 16px; border: 1px solid #D5D9D7; border-radius: 8px; background: white; cursor: pointer; }
.kv-vaults button:focus-visible, .kv-new-vault button:focus-visible { outline: 2px solid #2F6F8F; outline-offset: 2px; }
.kv-vault-name { display: block; font-weight: 600; }
.kv-vault-meta { color: #5B6670; font-size: 14px; }
.kv-new-vault { display: flex; gap: 8px; align-items: center; margin-top: 24px; }
.kv-vault-screen { display: flex; flex-direction: column; height: 100vh; }
.kv-appbar { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-bottom: 1px solid #D5D9D7; background: white; }
.kv-appbar-title { font-weight: 600; }
.kv-app { flex: 1; min-height: 0; }
```

- [ ] **Step 6: Type-check, run the tests and the version guard**

Run: `bun install && bun run tsc && bun run test && bun run stack:check`
Expected: tsc clean for both workspaces; sidecar + host tests pass; `stack 6.2.3-dev.44 pinned in 2 workspaces`.

If `tsc` reports that `@powerhousedao/knowledge-note` lacks a `./style.css` type or that `import * as knowledgeNote` does not match `DocumentModelLib`, keep the `as unknown as DocumentModelLib` cast (the root export has `manifest, documentModels, editors, upgradeManifests, processorFactory, aiTools`) and add `declare module "*.css";` to `vite-env.d.ts`.

- [ ] **Step 7: Open a vault in the browser, by hand**

Terminal 1: `bun run dev:sidecar` (wait for the readiness line). Terminal 2: `bun run dev:host`. Browser: `http://127.0.0.1:4200/`.
Expected: the landing lists the vault created in Task 7 Step 13 (or create one); clicking it shows the Knowledge Vault app (sidebar with Chat, Search, Notes, Graph, Sources…); the browser's network panel shows requests only to `127.0.0.1:4201` and `4202` — none to `localhost:4001`; the vault's first-open init creates its folders (Notes/Sources/… appear); "← Vaults" returns to the landing.

- [ ] **Step 8: Commit**

```bash
git add host bun.lock
git commit -m "feat(host): mount the Knowledge Vault app against the sidecar in a browser

Declares the desktop host before the vault package loads, installs one
GraphQLReactorClient (all document models) with a document cache and a
static package manager holding the vault and workflow packages, lists and
creates vaults over the control API, and renders the drive app with the
selected document's editor as its children — Connect's AppContainer,
reduced.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 9: One-command dev loop (`scripts/dev.mjs`)

**Files:**
- Create: `scripts/dev.mjs`, `scripts/lib/ready-line.mjs`
- Test: `scripts/lib/ready-line.test.mjs`

**Interfaces:**
- Produces: `parseReadyLine(line: string): { port: number; controlPort: number } | null`; `bun run dev [--no-shell]` starts the sidecar, waits for readiness, starts Vite with `VITE_SIDECAR_PORT/VITE_CONTROL_PORT/VITE_CONTROL_TOKEN`, then (unless `--no-shell`) `bunx @tauri-apps/cli dev`; Ctrl+C closes the sidecar's stdin, waits up to 15 s, then kills.

- [ ] **Step 1: Write the failing test**

```js
// scripts/lib/ready-line.test.mjs
import { describe, expect, it } from "vitest";
import { parseReadyLine } from "./ready-line.mjs";

describe("parseReadyLine", () => {
  it("parses the sidecar's readiness line", () => {
    expect(parseReadyLine('{"event":"ready","port":4201,"controlPort":4202}')).toEqual({ port: 4201, controlPort: 4202 });
  });
  it("ignores Switchboard logs, warnings and other JSON", () => {
    expect(parseReadyLine("[15:23:40] [switchboard] Registered /graphql")).toBeNull();
    expect(parseReadyLine("(node:1) [DEP0205] DeprecationWarning: module.register()")).toBeNull();
    expect(parseReadyLine('{"event":"other"}')).toBeNull();
    expect(parseReadyLine("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `bun run vitest run scripts/lib/ready-line.test.mjs` → FAIL (module missing).

- [ ] **Step 3: Implement**

```js
// scripts/lib/ready-line.mjs
export function parseReadyLine(line) {
  const t = line.trim();
  if (!t.startsWith("{")) return null;
  try {
    const v = JSON.parse(t);
    if (v && v.event === "ready" && Number.isInteger(v.port) && Number.isInteger(v.controlPort)) {
      return { port: v.port, controlPort: v.controlPort };
    }
  } catch {
    // not JSON
  }
  return null;
}
```

```js
// scripts/dev.mjs — sidecar + Vite (+ Tauri) with one Ctrl+C
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { parseReadyLine } from "./lib/ready-line.mjs";

const noShell = process.argv.includes("--no-shell");
const TOKEN = "dev-token";
const children = [];
const run = (cmd, args, opts = {}) => {
  const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"], ...opts });
  children.push(child);
  return child;
};

console.log("[dev] building and starting the sidecar…");
await new Promise((resolve, reject) => {
  const b = spawn("bun", ["run", "--cwd", "sidecar", "build"], { stdio: "inherit" });
  b.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`sidecar build failed (${code})`))));
});
const sidecar = run("node", ["dist/main.js"], {
  cwd: "sidecar",
  env: { ...process.env, KV_DATA_DIR: "../.dev-data", KV_PORT: "4201", KV_CONTROL_PORT: "4202", KV_CONTROL_TOKEN: TOKEN, KV_HOST_ORIGIN: "http://127.0.0.1:4200", KV_APP_VERSION: "dev" },
});
const ready = await new Promise((resolve, reject) => {
  const rl = createInterface({ input: sidecar.stdout });
  rl.on("line", (line) => {
    const r = parseReadyLine(line);
    if (r) resolve(r); else process.stdout.write(`[sidecar] ${line}\n`);
  });
  sidecar.on("exit", (code) => reject(new Error(`sidecar exited before ready (${code})`)));
});
console.log(`[dev] sidecar ready on ${ready.port} (control ${ready.controlPort})`);

const vite = run("bun", ["run", "--cwd", "host", "dev"], {
  env: { ...process.env, VITE_SIDECAR_PORT: String(ready.port), VITE_CONTROL_PORT: String(ready.controlPort), VITE_CONTROL_TOKEN: TOKEN },
});
vite.stdout.pipe(process.stdout);
if (!noShell) {
  await new Promise((r) => setTimeout(r, 1500));
  const shell = run("bunx", ["@tauri-apps/cli", "dev"], { env: { ...process.env, KV_DEV_SIDECAR_PORT: String(ready.port), KV_DEV_CONTROL_PORT: String(ready.controlPort), KV_DEV_CONTROL_TOKEN: TOKEN } });
  shell.stdout.pipe(process.stdout);
}

async function shutdown() {
  console.log("\n[dev] stopping…");
  for (const c of children) if (c !== sidecar) c.kill("SIGINT");
  sidecar.stdin.end(); // the sidecar treats stdin EOF as a graceful-stop request
  const exited = new Promise((r) => sidecar.on("exit", r));
  const timer = new Promise((r) => setTimeout(r, 15_000, "timeout"));
  if ((await Promise.race([exited, timer])) === "timeout") sidecar.kill("SIGKILL");
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
```

When the Tauri shell (Task 10) is attached, it must **not** spawn a second sidecar: the `KV_DEV_*` variables tell it to use the running one.

- [ ] **Step 4: Run the test and the loop**

Run: `bun run vitest run scripts/lib/ready-line.test.mjs` → PASS (2 tests). Then `bun run dev --no-shell` → sidecar logs, `[dev] sidecar ready on 4201 (control 4202)`, Vite banner; open `http://127.0.0.1:4200/`, open a vault; Ctrl+C → `[dev] stopping…`, the sidecar logs `Shutdown complete`, `.dev-data/reactor/` has no `postmaster.pid` left.

- [ ] **Step 5: Commit**

```bash
git add scripts
git commit -m "feat(dev): one-command dev loop — sidecar, Vite and the shell with one Ctrl+C

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 10: Tauri shell — spawn, supervise and stop the sidecar (dev mode)

**Files:**
- Create: `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/build.rs`, `src-tauri/capabilities/default.json`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/config.rs`, `src-tauri/src/sidecar.rs`, `src-tauri/icons/` (generated)
- Test: Rust unit tests inside `config.rs` and `sidecar.rs`

**Interfaces:**
- Consumes: readiness line and `KV_*` env contract (Task 7); `KV_DEV_*` variables from `scripts/dev.mjs` (Task 9).
- Produces: Tauri command `sidecar_info() -> Option<ReadyInfo>` where `ReadyInfo { port: u16, control_port: u16, control_token: String }` (serialised camelCase: `port`, `controlPort`, `controlToken`); event `sidecar:status` with `{ state: "starting" | "ready" | "exited", code?: i32 }`; functions `pick_free_port(start: u16) -> u16`, `new_control_token() -> String`, `parse_ready_line(&str) -> Option<(u16, u16)>`, `SidecarEnv::build(&AppPaths, &Ports, token: &str, app_version: &str) -> Vec<(String, String)>`.

- [ ] **Step 1: Scaffold with the Tauri CLI, then replace the generated config**

Run from the repo root: `bunx @tauri-apps/cli init --app-name "Knowledge Vault" --window-title "Knowledge Vault" --frontend-dist ../host/dist --dev-url http://127.0.0.1:4200 --before-dev-command "" --before-build-command "" --ci`
Then generate the app icon set from the vault's icon. The source is `assets/vault-icon.png` (698 × 736, RGBA — copied from `bai-knowledge-note/vault-icon.png`); Tauri's `icon` command needs a square, so pad it first:
```bash
magick assets/vault-icon.png -background none -gravity center -extent 1024x1024 assets/vault-icon-1024.png
bunx @tauri-apps/cli icon assets/vault-icon-1024.png      # writes src-tauri/icons/{32x32,128x128,128x128@2x}.png, icon.icns, icon.ico, …
cp assets/vault-icon-1024.png host/public/vault-icon.png   # favicon + landing mark (add <link rel="icon" href="/vault-icon.png"> to host/index.html)
```
Commit `assets/`, `src-tauri/icons/` and `host/public/vault-icon.png`; the dev window, dock/taskbar entry and the landing header all show the vault icon. Then set these files:

`src-tauri/tauri.conf.json`:
```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Knowledge Vault",
  "version": "0.1.0",
  "identifier": "xyz.powerhouse.desktop-knowledge-vault",
  "build": { "devUrl": "http://127.0.0.1:4200", "frontendDist": "../host/dist" },
  "app": {
    "windows": [{ "title": "Knowledge Vault", "width": 1280, "height": 820, "minWidth": 960, "minHeight": 640, "dragDropEnabled": false }],
    "security": { "csp": null }
  },
  "bundle": { "active": false, "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"] }
}
```
(`dragDropEnabled: false` is spec §5.8: HTML5 drops must reach the vault app's intake. Bundling is Phase 6.)

`src-tauri/capabilities/default.json`:
```json
{ "$schema": "../gen/schemas/desktop-schema.json", "identifier": "default", "windows": ["main"], "permissions": ["core:default", "core:event:default"] }
```

`src-tauri/Cargo.toml` (dependencies section — keep the generated `[package]`, `[lib]`, `[build-dependencies]`):
```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
rand = "0.8"
```

- [ ] **Step 2: Write the failing Rust tests** (inside the modules, `#[cfg(test)]`)

In `src-tauri/src/sidecar.rs` (module skeleton with tests first):
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn parses_the_ready_line_and_skips_everything_else() {
        assert_eq!(parse_ready_line(r#"{"event":"ready","port":4201,"controlPort":4202}"#), Some((4201, 4202)));
        assert_eq!(parse_ready_line("[15:23:40] [switchboard] Registered /graphql"), None);
        assert_eq!(parse_ready_line("(node:1) [DEP0205] DeprecationWarning"), None);
        assert_eq!(parse_ready_line(r#"{"event":"other","port":1}"#), None);
        assert_eq!(parse_ready_line(""), None);
    }

    #[test]
    fn env_carries_the_data_dir_intact_and_every_kv_variable() {
        let paths = AppPaths { data_dir: PathBuf::from("/tmp/Knowledge Vault äö/data"), sidecar_main: PathBuf::from("/app/sidecar/dist/main.js") };
        let ports = Ports { host: 4200, sidecar: 4301, control: 4302 };
        let env = SidecarEnv::build(&paths, &ports, "tok", "0.1.0");
        let get = |k: &str| env.iter().find(|(key, _)| key == k).map(|(_, v)| v.clone());
        assert_eq!(get("KV_DATA_DIR").as_deref(), Some("/tmp/Knowledge Vault äö/data"));
        assert_eq!(get("KV_PORT").as_deref(), Some("4301"));
        assert_eq!(get("KV_CONTROL_PORT").as_deref(), Some("4302"));
        assert_eq!(get("KV_CONTROL_TOKEN").as_deref(), Some("tok"));
        assert_eq!(get("KV_HOST_ORIGIN").as_deref(), Some("http://127.0.0.1:4200"));
        assert_eq!(get("KV_APP_VERSION").as_deref(), Some("0.1.0"));
        assert!(get("KV_PROTECTED").is_none());
    }
}
```

In `src-tauri/src/config.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn picks_the_next_free_port_when_the_default_is_taken() {
        let taken = TcpListener::bind("127.0.0.1:0").unwrap();
        let start = taken.local_addr().unwrap().port();
        let picked = pick_free_port(start);
        assert_ne!(picked, start);
        assert!(picked > start && picked <= start + 20);
    }

    #[test]
    fn control_token_is_long_and_random() {
        let a = new_control_token();
        let b = new_control_token();
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
    }
}
```

- [ ] **Step 3: Run to verify they fail** — `cd src-tauri && cargo test` → compile errors (functions undefined).

- [ ] **Step 4: Implement `config.rs`, `sidecar.rs`, `lib.rs`, `main.rs`**

```rust
// src-tauri/src/config.rs
use std::net::TcpListener;
use std::path::PathBuf;

pub struct AppPaths {
    /// Spec §3.3: the app-data directory (reactor/, read-model/, secrets/, logs/ live here).
    pub data_dir: PathBuf,
    /// The sidecar entry: in dev `../sidecar/dist/main.js` relative to the repo root.
    pub sidecar_main: PathBuf,
}

#[derive(Clone, Copy)]
pub struct Ports {
    pub host: u16,
    pub sidecar: u16,
    pub control: u16,
}

pub const DEFAULT_PORTS: Ports = Ports { host: 4200, sidecar: 4201, control: 4202 };

/// First port at or after `start` that binds on loopback, probing at most 20.
pub fn pick_free_port(start: u16) -> u16 {
    for p in start..start.saturating_add(20) {
        if TcpListener::bind(("127.0.0.1", p)).is_ok() {
            return p;
        }
    }
    start
}

/// 32 random bytes as hex; a new one every launch.
pub fn new_control_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
```

```rust
// src-tauri/src/sidecar.rs
use crate::config::{AppPaths, Ports};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadyInfo {
    pub port: u16,
    pub control_port: u16,
    pub control_token: String,
}

#[derive(Default)]
pub struct SidecarState {
    pub ready: Option<ReadyInfo>,
    pub child: Option<CommandChild>,
}

pub struct SidecarEnv;
impl SidecarEnv {
    pub fn build(paths: &AppPaths, ports: &Ports, token: &str, app_version: &str) -> Vec<(String, String)> {
        vec![
            ("KV_DATA_DIR".into(), paths.data_dir.to_string_lossy().into_owned()),
            ("KV_PORT".into(), ports.sidecar.to_string()),
            ("KV_CONTROL_PORT".into(), ports.control.to_string()),
            ("KV_CONTROL_TOKEN".into(), token.to_string()),
            ("KV_HOST_ORIGIN".into(), format!("http://127.0.0.1:{}", ports.host)),
            ("KV_APP_VERSION".into(), app_version.to_string()),
        ]
    }
}

/// `{"event":"ready","port":4201,"controlPort":4202}` → (4201, 4202); anything else → None.
pub fn parse_ready_line(line: &str) -> Option<(u16, u16)> {
    let t = line.trim();
    if !t.starts_with('{') {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(t).ok()?;
    if v.get("event")?.as_str()? != "ready" {
        return None;
    }
    let port = u16::try_from(v.get("port")?.as_u64()?).ok()?;
    let control = u16::try_from(v.get("controlPort")?.as_u64()?).ok()?;
    Some((port, control))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    state: &'static str,
    code: Option<i32>,
}

/// Spawn `node <sidecar_main>` with the env, relay readiness and exit as `sidecar:status` events.
pub fn spawn_sidecar(app: &AppHandle, paths: &AppPaths, ports: Ports, token: String, app_version: &str) -> tauri::Result<()> {
    let env = SidecarEnv::build(paths, &ports, &token, app_version);
    // cwd = sidecar/ (dist/main.js → ..): package names resolve through the workspace's node_modules.
    let sidecar_dir = paths.sidecar_main.parent().and_then(|d| d.parent()).map(|d| d.to_path_buf()).unwrap_or_default();
    let mut cmd = app.shell().command("node").args([paths.sidecar_main.to_string_lossy().as_ref()]).current_dir(sidecar_dir);
    for (k, v) in env {
        cmd = cmd.env(k, v);
    }
    let (mut rx, child) = cmd.spawn().map_err(|e| tauri::Error::Anyhow(e.into()))?;
    {
        let state = app.state::<Mutex<SidecarState>>();
        state.lock().unwrap().child = Some(child);
    }
    let _ = app.emit("sidecar:status", Status { state: "starting", code: None });
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    if let Some((port, control_port)) = parse_ready_line(&line) {
                        let info = ReadyInfo { port, control_port, control_token: token.clone() };
                        handle.state::<Mutex<SidecarState>>().lock().unwrap().ready = Some(info);
                        let _ = handle.emit("sidecar:status", Status { state: "ready", code: None });
                    } else {
                        print!("[sidecar] {line}");
                    }
                }
                CommandEvent::Stderr(bytes) => eprint!("[sidecar] {}", String::from_utf8_lossy(&bytes)),
                CommandEvent::Terminated(payload) => {
                    let mut st = handle.state::<Mutex<SidecarState>>().lock().unwrap();
                    st.ready = None;
                    st.child = None;
                    let _ = handle.emit("sidecar:status", Status { state: "exited", code: payload.code });
                }
                _ => {}
            }
        }
    });
    Ok(())
}

/// Graceful stop: close stdin (the sidecar's stop signal), wait up to 15 s, then kill.
pub fn stop_sidecar(app: &AppHandle) {
    let child = app.state::<Mutex<SidecarState>>().lock().unwrap().child.take();
    if let Some(child) = child {
        // A `stop` line is the sidecar's graceful-stop request (its stdin EOF is the other).
        let _ = child.write(b"stop\n");
        // The Terminated event clears `ready`; wait up to 15 s (75 × 200 ms) for it.
        for _ in 0..75 {
            if app.state::<Mutex<SidecarState>>().lock().unwrap().ready.is_none() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        let _ = child.kill();
    }
}

#[tauri::command]
pub fn sidecar_info(state: tauri::State<'_, Mutex<SidecarState>>) -> Option<ReadyInfo> {
    state.lock().unwrap().ready.clone()
}
```

The sidecar (Task 7) stops on stdin **EOF** or on a `stop` line; `tauri-plugin-shell` does not expose closing stdin separately from `kill()`, so `stop_sidecar` writes `stop\n` (the dev loop closes stdin instead).

```rust
// src-tauri/src/lib.rs
mod config;
mod sidecar;

use config::{new_control_token, pick_free_port, AppPaths, DEFAULT_PORTS, Ports};
use sidecar::{sidecar_info, spawn_sidecar, stop_sidecar, ReadyInfo, SidecarState};
use std::sync::Mutex;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(SidecarState::default()))
        .invoke_handler(tauri::generate_handler![sidecar_info])
        .setup(|app| {
            let handle = app.handle().clone();
            // Dev loop (scripts/dev.mjs) already runs a sidecar: adopt it instead of spawning another.
            if let (Ok(p), Ok(c), Ok(t)) = (std::env::var("KV_DEV_SIDECAR_PORT"), std::env::var("KV_DEV_CONTROL_PORT"), std::env::var("KV_DEV_CONTROL_TOKEN")) {
                let info = ReadyInfo { port: p.parse().unwrap_or(4201), control_port: c.parse().unwrap_or(4202), control_token: t };
                app.state::<Mutex<SidecarState>>().lock().unwrap().ready = Some(info);
                return Ok(());
            }
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let sidecar_main = std::env::current_dir()?.join("../sidecar/dist/main.js").canonicalize()?;
            let paths = AppPaths { data_dir, sidecar_main };
            let ports = Ports {
                host: DEFAULT_PORTS.host,
                sidecar: pick_free_port(DEFAULT_PORTS.sidecar),
                control: pick_free_port(DEFAULT_PORTS.control),
            };
            spawn_sidecar(&handle, &paths, ports, new_control_token(), env!("CARGO_PKG_VERSION"))?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                stop_sidecar(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running the Knowledge Vault shell");
}
```

```rust
// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    desktop_knowledge_vault_lib::run();
}
```
(Match the `[lib] name` the Tauri init generated — rename to `desktop_knowledge_vault_lib` in `Cargo.toml` if it differs.)

- [ ] **Step 5: Format, lint, test**

Run: `cd src-tauri && cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test`
Expected: clippy clean; 4 tests pass.

- [ ] **Step 6: Run the whole thing**

Run: `bun run dev` (from the repo root).
Expected: the sidecar's readiness line is relayed (`[dev] sidecar ready…`), Vite starts, the Tauri window opens on the landing (adopting the dev sidecar through `KV_DEV_*`), a vault opens inside the window, dropping a `.md` file onto the vault's intake area is received by the app (not swallowed by the window), the Pixi graph view renders (WebGL on WebKitGTK — spec §13 parity check). Closing the window and Ctrl+C in the terminal leave no `node sidecar/dist/main.js` process behind (`pgrep -f "sidecar/dist/main.js"` prints nothing).

Also run once **without** the dev loop to prove the shell's own spawn path: `bun run --cwd host build && bunx @tauri-apps/cli dev` with no `KV_DEV_*` env → the shell spawns `node ../sidecar/dist/main.js` itself (app-data under `~/.local/share/xyz.powerhouse.desktop-knowledge-vault/`), the window shows "Starting the engine…" then the landing.

- [ ] **Step 7: Commit**

```bash
git add src-tauri assets host/public/vault-icon.png host/index.html
git commit -m "feat(shell): Tauri window that spawns, supervises and stops the sidecar (dev mode)

Picks free loopback ports, generates a per-launch control token, spawns
node with the KV_* contract, relays the readiness line as sidecar:status
and sidecar_info, stops the sidecar on window close (stop line, 15 s,
kill). Under scripts/dev.mjs it adopts the already-running sidecar.
Drag-and-drop is left to the webview so the vault's intake receives files.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 11: End-to-end gate for Phase 0 (Playwright, browser mode)

**Files:**
- Create: `playwright.config.ts`, `e2e/open-vault.spec.ts`, `e2e/global-setup.ts`
- Modify: `sidecar/src/main.ts` (the `stop` line handler from Task 10)

**Interfaces:**
- Consumes: `bun run dev --no-shell` contract (Task 9), control API (Task 7), landing/vault screens (Task 8).

- [ ] **Step 1: Write the failing e2e test**

```ts
// playwright.config.ts
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: "http://127.0.0.1:4200", headless: true },
  webServer: { command: "node scripts/dev.mjs --no-shell", url: "http://127.0.0.1:4200", timeout: 180_000, reuseExistingServer: false, env: { KV_E2E: "1" } },
});
```

```ts
// e2e/global-setup.ts — a fresh engine store for every run
import { rmSync } from "node:fs";
export default function globalSetup() {
  rmSync(".dev-data", { recursive: true, force: true });
}
```

```ts
// e2e/open-vault.spec.ts
import { expect, test } from "@playwright/test";

test("create a vault on the landing and open the Knowledge Vault app against the local engine", async ({ page }) => {
  const foreign: string[] = [];
  page.on("request", (r) => { if (/localhost:4001|localhost:3001/.test(r.url())) foreign.push(r.url()); });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vaults" })).toBeVisible();
  await page.getByLabel("Name").fill("E2E vault");
  await page.getByRole("button", { name: "Create vault" }).click();

  // The vault app (from @powerhousedao/knowledge-note) renders its sidebar.
  await expect(page.getByText("Notes", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Graph", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Sign in to open this vault")).toHaveCount(0); // open mode: no gate

  await page.getByRole("button", { name: "← Vaults" }).click();
  await expect(page.getByRole("button", { name: /E2E vault/ })).toBeVisible();
  expect(foreign, "no request may reach a developer's Vetra ports").toEqual([]);
});
```

- [ ] **Step 2: Run it to verify it fails for the right reason** — `bunx playwright install chromium && bun run e2e` → before Tasks 7–9 land it fails on the web server; after them it should pass. If it fails on `Create vault`, check the control API response in the sidecar log; if it fails on "Notes", open `http://127.0.0.1:4200` by hand and read the console (the usual culprit is the host slot being set after the package loaded — see Task 8 `main.tsx` ordering).

- [ ] **Step 3: Make it pass** — fix whatever the run shows (expected: nothing, if Tasks 7–10 were verified by hand).

- [ ] **Step 4: Run the full gate**

Run: `bun run tsc && bun run test && bun run stack:check && (cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test) && bun run e2e`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts e2e sidecar/src/main.ts
git commit -m "test(e2e): Phase 0 gate — create and open a vault against the local engine

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Done when

- `bun run dev` opens a window; a vault can be created and opened; the Knowledge Vault app renders with its editors; no request leaves for ports 4001/3001; closing the window stops the sidecar cleanly.
- `bun run e2e` passes on a fresh store; `cargo test`, `bun run test`, `bun run tsc`, `bun run stack:check` pass.
- In `bai-knowledge-note`, branch `feat/desktop-host-mode` holds Tasks 1–5 with its full gate green, ready for review and a package release in a later phase.

## Not in this plan (next plans)

Phase 1: the designed landing (spec §5.7), vault metadata (note counts from the graph index rather than the drive tree), sign-in through the sidecar's Renown session flow, the protection switch and open-mode changes in the `http` subgraph and `AuthGate`; Phase 2: pipeline template and Workflow Studio; Phase 3: remote vaults; Phase 4: conversion tiers; Phase 5: resilience (supervisor restarts, backups, upgrade guard, tray); Phase 6: packaging (bundled Node, resources, installers), CI and performance gates.
