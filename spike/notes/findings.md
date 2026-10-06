# Standalone Knowledge Vault — spike findings (2026-10-06, THROWAWAY)

Question: cheapest way to run the vault as a fully local app (own reactor,
indexer, pipeline; optional remote vault via Renown), and what would a Rust
shell/engine actually save? Measured on a copy of the dev vault's
"powerhouse knowledge" drive: 2,842 docs, 2,165 graph nodes, 8,458 edges,
102,661 operations. Probe Switchboard = `@powerhousedao/switchboard` 6.2.3-dev.44
started programmatically (bin/run-switchboard.mjs), workflows and auth OFF.

## Storage engine decides memory and speed (not the JS runtime)

| store                                   | boot→GraphQL | index | idle RSS | after queries | sem. search (median) | drive doc read | shutdown |
|-----------------------------------------|-------------:|------:|---------:|--------------:|---------------------:|---------------:|---------:|
| PGlite + AtomicNodeFs snapshot (ph vetra today) | 11.6 s | 16.2 s | 3,659 MB | 3,971 MB | 89 ms (20–680) | 293 ms | 6.0 s |
| PGlite + plain NodeFS data dir          |        6.0 s | 12.1 s |   829 MB |      1,474 MB | 32 ms                | 205 ms         |    0.5 s |
| Postgres 17 (docker, +~170 MB)          |        5.6 s | 13.5 s |   822 MB |      1,391 MB | 19 ms                | 105 ms         |    0.5 s |
| empty in-memory store (fixed stack cost)|        5.4 s |     — | 1,038 MB |             — | —                    | —              |    0.5 s |

- The 1 GB snapshot holds ~660 MB of real data (CSV): Keyframe 319 MB, Operation 131 MB,
  operation_index 125 MB, DocumentSnapshot 34 MB; read model ~50 MB.
- AtomicNodeFs keeps the whole DB in Emscripten MEMFS and rewrites the snapshot file;
  its own docs say "intended for local dev use". Swapping it for PGlite's NodeFS
  (bin/nodefs-shim.mjs via a loader hook) needed no other change.
- Fixed cost of the node stack ≈ 1 GB RSS (2 PGlite instances, Apollo gateway, Express,
  OTel/Sentry/Pyroscope, our package incl. 34 MB embedding model + onnxruntime wasm).

## Sync-channel churn
52 polling sync remotes accumulated since 2026-09-12 across 10 drives (48 unfiltered
full-drive replicas = Connect tabs; 4 remote-first sentinels). A few minutes after boot
the reactor re-derives every outbox over the 102k-op log ("Outbox … past its bound of
10000 operations; evicting") and the first maintenance pass ran VACUUM FULL on the
>256 MB snapshot. This is the slowness seen on the dev server after the upload.

## Single binary
- `bun build --compile`: 133 MB binary in 3 s after externalising/stubbing 20 optional
  modules (knex mysql/mssql/sqlite dialects, Fastify/Mercurius gateway, prettier plugins)
  — but Bun 1.4.2 lacks `module.findPackageJSON` → does not boot. Bun's bundle also emits
  Bun-only import attributes, so it does not run under Node either.
- Realistic route: Node SEA + a Node bundler (esbuild/rolldown) + embedded assets
  (pglite 8.5 MB wasm, onnxruntime 22 MB wasm, model 34 MB). ~1–2 weeks of packaging work.
  Pragmatic alternative: ship node + node_modules (runtime dist 98 MB) as a sidecar.

## Shell without the Connect UI
- `ph connect build` → 136 MB static (88 MB without .map). Exits 1 because the PWA
  precache step rejects the 22 MB onnxruntime wasm (>2 MiB limit) although the build is
  complete. Runtime config supports single-vault use: drives.defaultDrives (objects
  {url,name,icon}), sections.local.enabled=false, allowAddDrive, branding.appName.
- Headless Chromium against the probe backend: Connect shell renders, GET /d/<id> → 200
  with graphqlEndpoint, but the vault app never appears (spinner on /d/<id>).
  Causes found: (1) editors/shared/subgraph-endpoint.ts hardcodes localhost → :4001; when
  unreachable the package's boot code made 250 requests in 100 s (rewriting 4001→4101:
  1 request). (2) the package adopts vault drives only once a Renown bearer exists
  (lib/remote-memory.ts, by design for protected Switchboards) — anonymous automation
  cannot pass; needs an interactive sign-in test.
- Tauri vs Electron (public figures): Tauri 3–10 MB bundle / ~42 MB idle vs Electron
  120–200 MB / ~168 MB idle. ph-reactor (Powerhouse's Rust reactor) runs its own JSON
  models, REST only, libp2p peers only, Linux-only → not an engine for this vault.

## Recommendation
Tauri shell + node sidecar (`startSwitchboard` programmatic, PGlite NodeFS data dir in the
app data folder, workflows on, OTel/Sentry off, local auth off, Renown for remote vaults)
+ trimmed static Connect (single default drive, local section off) hosting the unchanged
drive app. Prerequisites: configurable Switchboard origin in the package + an explicit
local/no-auth mode in its boot logic; prune/avoid sync-channel accumulation; fix the
connect-build precache limit. Do not pursue bun compile or a Rust engine now.

Artefacts: bin/ (runner, measure.sh, converters, smoke test), measure/ (logs, JSON,
screenshots), store-a (snapshot copy + CSV dump), store-d (NodeFS data dirs),
connect-dist (static build). Postgres container `spike-pg` (stopped, data kept).
