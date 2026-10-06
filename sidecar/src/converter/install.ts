import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

/**
 * Installing the `docling.rs` binding into the app's data dir (Plan 4, Stage B).
 *
 * Two npm tarballs — the JS package and this machine's platform package —
 * downloaded resumably into `downloads/`, verified against the registry's
 * `dist.integrity` (sha512) before anything is extracted, unpacked with `tar`
 * into a staging dir, then swapped into `node_modules/` in one rename. The
 * version is the one the vendored service is tested against.
 */
export const BINDING_VERSION = "1.58.0";
export const DEFAULT_REGISTRY = "https://registry.npmjs.org";

export type InstallPhase = "metadata" | "downloading" | "verifying" | "extracting" | "done";
export type InstallProgress = { phase: InstallPhase; file?: string; bytes?: number; total?: number | null };
export type BindingManifest = { version: string; platform: string; installedAt: string; bytes: number };

export class IntegrityError extends Error {}

export type InstallBindingOptions = {
  /** The converter's dir in app-data (`<dataDir>/converter`). */
  dir: string;
  triple: string;
  version?: string;
  registry?: string;
  fetchImpl?: typeof fetch;
  /** Runs `tar` with the given arguments; injectable for tests. */
  tar?: (args: string[]) => Promise<void>;
  onProgress?: (progress: InstallProgress) => void;
  maxAttempts?: number;
};

export async function installBinding(opts: InstallBindingOptions): Promise<BindingManifest> {
  const version = opts.version ?? BINDING_VERSION;
  const registry = (opts.registry ?? DEFAULT_REGISTRY).replace(/\/+$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const progress = opts.onProgress ?? (() => {});
  const tar = opts.tar ?? runTar;
  const downloads = join(opts.dir, "downloads");
  const staging = join(opts.dir, "node_modules.staging");
  mkdirSync(downloads, { recursive: true });
  rmSync(staging, { recursive: true, force: true });
  let bytes = 0;
  for (const name of ["docling.rs", `docling.rs-${opts.triple}`]) {
    progress({ phase: "metadata", file: name });
    const meta = await registryMetadata(fetchImpl, registry, name, version);
    const tgz = join(downloads, `${name}-${version}.tgz`);
    await download(fetchImpl, meta.tarball, tgz, (b, total) => progress({ phase: "downloading", file: name, bytes: b, total }), opts.maxAttempts ?? 5);
    progress({ phase: "verifying", file: name });
    await verifyIntegrity(tgz, meta.integrity);
    progress({ phase: "extracting", file: name });
    const dest = join(staging, name);
    mkdirSync(dest, { recursive: true });
    await tar(["-xzf", tgz, "-C", dest, "--strip-components=1"]);
    bytes += statSync(tgz).size;
    rmSync(tgz, { force: true });
  }
  const final = join(opts.dir, "node_modules");
  rmSync(final, { recursive: true, force: true });
  renameSync(staging, final);
  const manifest: BindingManifest = { version, platform: opts.triple, installedAt: new Date().toISOString(), bytes };
  writeFileSync(join(opts.dir, "binding.json"), JSON.stringify(manifest, null, 2) + "\n");
  progress({ phase: "done" });
  return manifest;
}

/** The installed binding, if `binding.json` and the package are both there. */
export function installedBinding(dir: string): BindingManifest | null {
  try {
    const manifest = JSON.parse(readFileSync(join(dir, "binding.json"), "utf8")) as BindingManifest;
    return existsSync(join(dir, "node_modules", "docling.rs", "package.json")) ? manifest : null;
  } catch {
    return null;
  }
}

export function removeBinding(dir: string): void {
  rmSync(join(dir, "node_modules"), { recursive: true, force: true });
  rmSync(join(dir, "node_modules.staging"), { recursive: true, force: true });
  rmSync(join(dir, "binding.json"), { force: true });
}

async function registryMetadata(fetchImpl: typeof fetch, registry: string, name: string, version: string): Promise<{ tarball: string; integrity: string }> {
  const res = await fetchImpl(`${registry}/${name}/${version}`);
  if (!res.ok) throw new Error(`The registry answered HTTP ${res.status} for ${name}@${version}.`);
  const body = (await res.json()) as { dist?: { tarball?: string; integrity?: string } };
  if (!body.dist?.tarball || !body.dist.integrity) throw new Error(`The registry's metadata for ${name}@${version} has no tarball or integrity.`);
  return { tarball: body.dist.tarball, integrity: body.dist.integrity };
}

/**
 * Download to `<dest>.part`, resuming with a Range request after a dropped
 * connection or a short read, and rename to `dest` when the byte count says
 * the file is complete. Integrity is checked afterwards, not here.
 */
async function download(fetchImpl: typeof fetch, url: string, dest: string, onProgress: (bytes: number, total: number | null) => void, maxAttempts: number): Promise<void> {
  if (existsSync(dest)) return; // a complete download from an earlier attempt; verified next
  const part = `${dest}.part`;
  let have = existsSync(part) ? statSync(part).size : 0;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetchImpl(url, have > 0 ? { headers: { range: `bytes=${have}-` } } : {});
      if (res.status === 416) break; // nothing left to fetch
      if (res.status === 200 && have > 0) {
        // The server ignored the range: start over.
        rmSync(part, { force: true });
        have = 0;
      }
      if (res.status !== 200 && res.status !== 206) throw new Error(`HTTP ${res.status} for ${url}`);
      const length = Number(res.headers.get("content-length") ?? 0) || null;
      const total = res.status === 206 ? totalFromContentRange(res.headers.get("content-range")) : length;
      if (!res.body) throw new Error(`empty body for ${url}`);
      const out = createWriteStream(part, { flags: have > 0 ? "a" : "w" });
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          have += chunk.length;
          onProgress(have, total);
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), counter, out);
      if (total === null || have >= total) {
        renameSync(part, dest);
        return;
      }
      lastError = new Error(`short read: ${have} of ${total} bytes`);
    } catch (error) {
      lastError = error;
      have = existsSync(part) ? statSync(part).size : 0;
    }
  }
  if (existsSync(part) && !existsSync(dest)) {
    // Nothing left to fetch: the file is complete.
    if (lastError === null) {
      renameSync(part, dest);
      return;
    }
  }
  throw new Error(`The download of ${url} did not complete: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function totalFromContentRange(header: string | null): number | null {
  const m = /\/(\d+)\s*$/.exec(header ?? "");
  return m ? Number(m[1]) : null;
}

/** `sha512-<base64>` as the registry states it, against the bytes on disk; a mismatch removes the file. */
export async function verifyIntegrity(file: string, integrity: string): Promise<void> {
  const [algorithm, expected] = integrity.split("-", 2);
  if (!algorithm || !expected || !/^sha(256|384|512)$/.test(algorithm)) throw new IntegrityError(`unsupported integrity: ${integrity}`);
  const hash = createHash(algorithm);
  await pipeline(createReadStream(file), hash);
  const actual = hash.digest("base64");
  if (actual !== expected) {
    rmSync(file, { force: true });
    throw new IntegrityError(`${file} does not match the registry's ${algorithm} — removed; try again.`);
  }
}

function runTar(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", (error) => reject(new Error(`tar could not run: ${error.message}`)));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`tar exited with ${code}: ${stderr.trim()}`))));
  });
}
