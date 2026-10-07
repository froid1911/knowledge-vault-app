import { lstatSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * Plan 6: trim a production node_modules for one target. Only two kinds of things go:
 *  - other platforms' native builds — a package whose name carries an OS *and* a CPU
 *    (`@img/sharp-darwin-arm64`, `lightningcss-linux-x64-musl`) that is not this target's,
 *    and onnxruntime-node's per-platform folders;
 *  - source maps and type declarations.
 * Never a directory by its name: `viem/_esm/actions/test` is code (the probe broke the engine that way).
 */
const TARGETS = {
  "x86_64-unknown-linux-gnu": { os: "linux", cpu: "x64", libc: "gnu" },
  "aarch64-unknown-linux-gnu": { os: "linux", cpu: "arm64", libc: "gnu" },
  "aarch64-apple-darwin": { os: "darwin", cpu: "arm64", libc: null },
  "x86_64-apple-darwin": { os: "darwin", cpu: "x64", libc: null },
};
const OS = new Set(["linux", "linuxmusl", "darwin", "win32", "windows", "android", "freebsd", "openbsd", "netbsd", "sunos", "aix", "wasm32", "openharmony", "wasi"]);
const CPU = new Set(["x64", "arm64", "arm", "ia32", "s390x", "ppc64", "riscv64", "loong64", "universal", "x86_64", "aarch64", "mips64el"]);
const CPU_ALIAS = { x86_64: "x64", aarch64: "arm64" };
const LIBC = new Set(["gnu", "musl", "msvc", "gnueabihf", "musleabihf"]);
const DROP_FILE = /\.(map|d\.ts|d\.mts|d\.cts)$/;

/** Is a package named like a platform build, and is it another platform's? */
export function foreignNative(name, target) {
  const tokens = name.split("/").pop().split("-");
  const os = tokens.find((t) => OS.has(t));
  const cpu = tokens.find((t) => CPU.has(t));
  if (!os || !cpu) return false; // not a platform build
  const libc = tokens.find((t) => LIBC.has(t)) ?? (os === "linuxmusl" ? "musl" : null);
  const osName = os === "linuxmusl" ? "linux" : os;
  if (osName !== target.os) return true;
  if (cpu !== "universal" && (CPU_ALIAS[cpu] ?? cpu) !== target.cpu) return true;
  if (target.os === "linux" && libc && !libc.startsWith(target.libc)) return true;
  return false;
}

function size(path) {
  const s = lstatSync(path);
  if (!s.isDirectory()) return s.size;
  return readdirSync(path).reduce((n, e) => n + size(join(path, e)), 0);
}

/** Prunes `nodeModules` in place for `triple`; returns the bytes freed. */
export function prune(nodeModules, triple) {
  const target = TARGETS[triple];
  if (!target) throw new Error(`No prune rules for target ${triple} (known: ${Object.keys(TARGETS).join(", ")}).`);
  let freed = 0;
  const remove = (p) => {
    freed += size(p);
    rmSync(p, { recursive: true, force: true });
  };
  // other platforms' packages, top level and scoped
  for (const entry of readdirSync(nodeModules)) {
    const p = join(nodeModules, entry);
    if (entry.startsWith("@")) {
      for (const pkg of readdirSync(p)) if (foreignNative(`${entry}/${pkg}`, target)) remove(join(p, pkg));
    } else if (foreignNative(entry, target)) {
      remove(p);
    }
  }
  // onnxruntime-node ships every platform in one package: bin/<napi>/<os>/<cpu>
  const ort = join(nodeModules, "onnxruntime-node", "bin");
  try {
    for (const napi of readdirSync(ort)) {
      for (const os of readdirSync(join(ort, napi))) {
        if (os !== target.os) remove(join(ort, napi, os));
        else for (const cpu of readdirSync(join(ort, napi, os))) if (cpu !== target.cpu) remove(join(ort, napi, os, cpu));
      }
    }
  } catch {
    // not installed
  }
  // maps and declarations — files only
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && DROP_FILE.test(e.name)) remove(p);
    }
  };
  walk(nodeModules);
  return freed;
}
