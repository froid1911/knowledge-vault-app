import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installBinding, installedBinding, IntegrityError, removeBinding, type InstallProgress } from "./install.js";
import { platformTriple } from "./platform.js";

const require = createRequire(import.meta.url);

/** A real npm-shaped tarball: `package/` prefix, built with the same tar the installer extracts with. */
function tarball(files: Record<string, Buffer | string>): Buffer {
  const dir = mkdtemp("kv-tgz-");
  mkdirSync(join(dir, "package"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, "package", name), content);
  const out = join(dir, "pkg.tgz");
  const r = spawnSync("tar", ["-czf", out, "-C", dir, "package"]);
  if (r.status !== 0) throw new Error(`tar failed: ${r.stderr.toString()}`);
  return readFileSync(out);
}
const mkdtemp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));
const sri = (bytes: Buffer) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

/**
 * A fake registry and tarball host: metadata routes, Range-aware downloads, an
 * optional one-time connection drop at a fraction of the first full request,
 * and an optional wrong integrity.
 */
async function fakeRegistry(opts: { dropOnceAt?: number; wrongIntegrity?: boolean } = {}) {
  const js = tarball({ "package.json": JSON.stringify({ name: "docling.rs", version: "1.58.0", main: "index.js" }), "index.js": 'module.exports = { marker: "fake-docling" };\n' });
  const native = tarball({ "package.json": JSON.stringify({ name: "docling.rs-linux-x64-gnu", version: "1.58.0" }), "docling-rs.linux-x64-gnu.node": randomBytes(2 * 1024 * 1024) /* incompressible, like the real .node */ });
  const files: Record<string, Buffer> = { "docling.rs": js, "docling.rs-linux-x64-gnu": native };
  const requests: { url: string; range: string | undefined }[] = [];
  let dropped = false;
  const server: Server = createServer((req, res) => {
    const url = req.url ?? "/";
    requests.push({ url, range: req.headers.range });
    const meta = /^\/(docling\.rs(?:-[a-z0-9-]+)?)\/1\.58\.0$/.exec(url);
    if (meta) {
      const name = meta[1]!;
      const bytes = files[name]!;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ dist: { tarball: `http://127.0.0.1:${port}/tgz/${name}`, integrity: opts.wrongIntegrity ? sri(Buffer.from("not the file")) : sri(bytes) } }));
      return;
    }
    const tgz = /^\/tgz\/(.+)$/.exec(url);
    if (tgz) {
      const bytes = files[tgz[1]!]!;
      const range = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
      if (range) {
        const from = Number(range[1]);
        res.writeHead(206, { "content-range": `bytes ${from}-${bytes.length - 1}/${bytes.length}`, "content-length": bytes.length - from });
        res.end(bytes.subarray(from));
        return;
      }
      res.writeHead(200, { "content-length": bytes.length });
      if (opts.dropOnceAt !== undefined && !dropped && bytes.length > 100_000) {
        dropped = true;
        res.write(bytes.subarray(0, Math.floor(bytes.length * opts.dropOnceAt)));
        setTimeout(() => req.socket.destroy(), 10);
        return;
      }
      res.end(bytes);
      return;
    }
    res.writeHead(404).end();
  });
  const port = await new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)));
  return { registry: `http://127.0.0.1:${port}`, requests, close: () => new Promise<void>((r) => server.close(() => r())) };
}

let closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers) await c();
  closers = [];
});

describe("installBinding", () => {
  it("downloads both packages, verifies them, extracts them side by side, and writes the manifest", async () => {
    const reg = await fakeRegistry();
    closers.push(reg.close);
    const dir = mkdtemp("kv-conv-");
    const phases: InstallProgress[] = [];
    const manifest = await installBinding({ dir, triple: "linux-x64-gnu", registry: reg.registry, onProgress: (p) => phases.push(p) });
    expect(manifest).toMatchObject({ version: "1.58.0", platform: "linux-x64-gnu" });
    expect(manifest.bytes).toBeGreaterThan(100_000);
    expect(require(join(dir, "node_modules", "docling.rs"))).toEqual({ marker: "fake-docling" });
    expect(existsSync(join(dir, "node_modules", "docling.rs-linux-x64-gnu", "docling-rs.linux-x64-gnu.node"))).toBe(true);
    expect(installedBinding(dir)).toMatchObject({ version: "1.58.0" });
    expect(existsSync(join(dir, "downloads", "docling.rs-1.58.0.tgz"))).toBe(false); // tidied
    expect(phases.map((p) => p.phase)).toEqual(expect.arrayContaining(["metadata", "downloading", "verifying", "extracting", "done"]));
    const downloading = phases.filter((p) => p.phase === "downloading" && p.file === "docling.rs-linux-x64-gnu");
    expect(downloading.at(-1)!.bytes).toBe(downloading.at(-1)!.total);
    removeBinding(dir);
    expect(installedBinding(dir)).toBeNull();
    expect(existsSync(join(dir, "node_modules"))).toBe(false);
  });

  it("resumes with a Range request after the connection drops mid-download", async () => {
    const reg = await fakeRegistry({ dropOnceAt: 0.6 });
    closers.push(reg.close);
    const dir = mkdtemp("kv-conv-");
    await installBinding({ dir, triple: "linux-x64-gnu", registry: reg.registry });
    const native = reg.requests.filter((r) => r.url === "/tgz/docling.rs-linux-x64-gnu");
    expect(native.length).toBe(2);
    expect(native[0]!.range).toBeUndefined();
    expect(native[1]!.range).toMatch(/^bytes=\d+-$/);
    expect(Number(/\d+/.exec(native[1]!.range!)![0])).toBeGreaterThan(1_000_000);
    expect(existsSync(join(dir, "node_modules", "docling.rs-linux-x64-gnu", "docling-rs.linux-x64-gnu.node"))).toBe(true);
  });

  it("refuses a tarball that does not match the registry's integrity and leaves nothing behind", async () => {
    const reg = await fakeRegistry({ wrongIntegrity: true });
    closers.push(reg.close);
    const dir = mkdtemp("kv-conv-");
    await expect(installBinding({ dir, triple: "linux-x64-gnu", registry: reg.registry })).rejects.toBeInstanceOf(IntegrityError);
    expect(existsSync(join(dir, "node_modules"))).toBe(false);
    expect(existsSync(join(dir, "downloads", "docling.rs-1.58.0.tgz"))).toBe(false);
    expect(existsSync(join(dir, "downloads", "docling.rs-1.58.0.tgz.part"))).toBe(false);
    expect(installedBinding(dir)).toBeNull();
  });
});

describe("platformTriple", () => {
  it("names the binding for Linux glibc and Windows x64, and says why not elsewhere", () => {
    expect(platformTriple("linux", "x64", false)).toEqual({ triple: "linux-x64-gnu", reason: null });
    expect(platformTriple("linux", "arm64", false)).toEqual({ triple: "linux-arm64-gnu", reason: null });
    expect(platformTriple("win32", "x64", false)).toEqual({ triple: "win32-x64-msvc", reason: null });
    expect(platformTriple("linux", "x64", true).triple).toBeNull();
    expect(platformTriple("darwin", "arm64", false)).toMatchObject({ triple: null, reason: expect.stringMatching(/macOS/) });
    expect(platformTriple("freebsd", "x64", false).reason).toMatch(/freebsd\/x64/);
  });
});
