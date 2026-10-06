# Desktop Knowledge Vault — Phase 4 "Document conversion" Implementation Plan (outline — expand to bite-sized TDD steps before execution)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This document fixes interfaces, contracts and tests; expand each task into write-test / run / implement / run / commit steps when Phase 3 has landed.

**Goal:** Documents convert on the user's machine: a built-in baseline always works (text, markdown, HTML, text-layer PDFs), and the full `docling.rs` engine can be installed natively (Linux/Windows), run in Docker, or reached at a remote URL — each enabled and disabled from Settings without restarting the engine.

**Architecture:** The vault package's `convert` subgraph gets a process-local setter for the conversion URL (the sidecar lives in the same process and imports the same module), so switching tiers is a function call. Tier 0 is a tiny HTTP service inside the sidecar implementing the documented contract (`GET /health`, `POST /convert?filename=…[&ocr=1][&job=…]`, `GET /progress/:job`). Tier 1 is a second Node process the sidecar spawns, serving the same contract over `docling.rs`; its binding and ~1.36 GB of models are downloaded on demand into `converter/`. Tier 2 is a Docker container the Rust shell controls through the `docker` CLI. The host shows one Conversion setting with the tiers the machine can use.

**Tech Stack:** `pdfjs-dist` (already a vault dependency) for tier 0; `docling.rs` 1.98.x (`convertFileAsync`, `chunkFileAsync`) for tier 1; `docker` CLI for tier 2.

**Spec:** §6 (tiers table), §7.4 (runtime conversion URL), §5.2 (Settings › Conversion), §9 (converter states). **Prerequisites:** Plans 0–3.

## Global Constraints
- Plans 0–3 constraints apply.
- The conversion contract is exactly what `subgraphs/convert/lib/service.ts` expects: `POST /convert?filename=<name>` with `content-type: application/octet-stream` body → JSON `ConversionResult { markdown, chunks: ConversionChunk[], textSource, pages?, ocr?, needsOcr?, ocrOffer?, quality? }`; `GET /health` → 200 JSON `{ ok: true, engine: "builtin" | "docling.rs" | "docker", ocr: "tesseract" | "docling" | null, version }`; `GET /progress/:job` → `ConversionProgress { phase, pages, pagesDone, elapsedMs }`, 404 after a minute.
- Tier 1 memory is released on Disable (the child process exits); Tier 2 `Off` is `docker stop` (container kept), `Remove` is `docker rm`.
- The Docker image reference is a Setting (`conversion.dockerImage`), empty by default — the engine's image is published by its own repository; the tier is shown as "needs an image reference" until set.
- Copy: states *Not available on this platform · Not installed · Installing (n %) · Starting · Ready · Not responding*; actions *Install converter · Enable · Disable · Start Docker · Remove*.

## Review Focus
1. **A PDF with no text layer** on tier 0: the result says `textSource: "pdfjs"` with empty markdown and `needsOcr: { via: "docling-ocr", estimateSeconds }` so the UI offers the real engine instead of silently producing an empty source — tier-0 contract test with a scanned fixture.
2. **A 200 MB upload**: the built-in service streams the body to a temp file and refuses beyond 256 MB with 413 and a sentence — tier-0 test with a size-limited fake stream.
3. **Install interrupted at 60 %**: the download resumes from the partial file (HTTP Range) and verifies the checksum of each artefact before use — tier-1 installer test with a fake server that drops the connection once.
4. **Docker present but the user lacks socket permission**: `docker version` fails with "permission denied" → the setting shows the exact remedy ("Add your user to the docker group, then log out and in.") — Rust parser test on captured stderr.
5. **Switching tiers while a conversion is running**: the in-flight job finishes on the old service; the new URL applies to the next request — setter test in the package (`setConversionServiceUrl` is read per request).

## Tasks (interfaces fixed; expand before execution)

### Task 1 — package: runtime conversion URL
Files: `subgraphs/convert/lib/runtime-config.ts` (new): `setConversionServiceUrl(url: string | undefined): void`, `getConversionServiceUrl(): string | undefined` (module-level, read on every request by `ConvertSubgraph`), exported from `subgraphs/index.ts`; `routes/health.ts` reports `configured` from the live value and adds `source: "env" | "runtime"`. Tests: setter precedence over `CONVERT_SERVICE_URL`; health reflects a change without restart. Commit `feat(convert): conversion service URL settable at runtime`.

### Task 2 — sidecar: tier-0 built-in converter
Files: `sidecar/src/converter/builtin.ts` (HTTP server on `127.0.0.1:0`), `sidecar/src/converter/text.ts` (`.md/.txt/.html` → markdown; HTML via a small allow-list converter: headings, paragraphs, lists, links, code), `sidecar/src/converter/pdf.ts` (`pdfjs-dist` legacy build: text per page → markdown with page markers; `pages`; `needsOcr` when < 20 characters per page on average), `sidecar/src/converter/chunks.ts` (split on headings, ≤ 1,200 characters, `contextualized` = heading path + text), tests with fixtures `e2e/fixtures/{sample.md,sample.html,text.pdf,scanned.pdf}`. `main.ts`: start it at boot and `setConversionServiceUrl(builtinUrl)` unless another tier is enabled in `conversion.json`. Commit `feat(sidecar): built-in converter (markdown, HTML, text PDFs)`.

### Task 3 — sidecar: tier-1 native converter manager
Files: `sidecar/src/converter/native-install.ts` (download `https://registry.npmjs.org/docling.rs/-/docling.rs-<v>.tgz` and `docling.rs-<triple>/-/…` into `converter/node_modules/` with resumable fetch + sha512 from the registry metadata; then models: run the upstream `scripts/install/download_dependencies.sh` with `MODELS_DIR=<dataDir>/converter/models` on Linux/macOS — Windows uses the PowerShell equivalent the upstream repo documents; record `converter/manifest.json { version, platform, installedAt, sizeBytes }`), `sidecar/src/converter/native-service.ts` (child entry: `convertFileAsync(path, { to: "markdown" })` + `chunkFileAsync` → `ConversionResult`, `strict: true`), `sidecar/src/converter/native.ts` (spawn/stop child, health poll, state machine `not-available | not-installed | installing | starting | ready | down`), control routes `GET /converter`, `POST /converter/install`, `POST /converter/enable {tier}`, `POST /converter/disable`, `GET /converter/progress`. Platform gate: `process.platform === "linux" || "win32"` and `arch` in `x64|arm64`. Commit `feat(sidecar): native docling.rs converter — install, enable, disable`.

### Task 4 — shell: tier-2 Docker control
Files: `src-tauri/src/docker.rs`: `docker_status() -> DockerStatus { available, version, permissionDenied, running: Option<ContainerInfo> }` (parses `docker version --format json` and `docker ps --filter name=kv-convert --format json`), `docker_pull(image) ` streaming progress lines to events `converter:progress`, `docker_start(image, port=5011)` = `docker run -d --name kv-convert -p 127.0.0.1:5011:5011 -v kv-docling-models:/models <image>`, `docker_stop()`, `docker_remove()`; Tauri commands for each; on app exit `docker_stop` when the config says so. Tests: parsers on captured outputs (version JSON, permission-denied stderr, pull progress lines). Commit `feat(shell): Docker converter control`.

### Task 5 — host: Settings › Conversion
Files: `host/src/settings/Conversion.tsx`, `host/src/api/converter.ts` (+ tests): tier cards shown per platform/availability, states and the single action per state, progress bars for install/pull, the Docker image field, a "Test with a PDF" button that converts `e2e/fixtures/text.pdf` through the vault's `convert` route and shows `textSource`. Commit `feat(host): conversion settings`.

### Task 6 — e2e
Drop `sample.md` and `text.pdf` onto intake → sources created with the right `textSource`; enable tier 1 on a Linux runner with a cached `converter/` directory (CI caches the ~1.4 GB download by manifest hash) → a DOCX fixture converts; Docker tier covered by a manual checklist in `e2e/MANUAL.md`.

## Done when
Tier 0 converts text, markdown, HTML and text PDFs out of the box; tier 1 installs and runs on Linux, tier 2 on a machine with Docker, remote URL anywhere; states and remedies match the spec; the vault's `convert/health` follows the setting live.
