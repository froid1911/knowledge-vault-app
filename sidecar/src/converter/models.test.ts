import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { entryFor } from "../converter-hooks.mjs";
import { dirBytes, installModels, modelsInstalled, parseFetchLine, removeModels, type ModelsProgress } from "./models.js";

const HOOKS = fileURLToPath(new URL("../converter-hooks.mjs", import.meta.url));
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

/** Stands in for the vendored fetch-models.mjs: prints upstream-shaped lines and writes the layout model. */
function fakeFetcher(dir: string, fail = false): string {
  const script = join(dir, "fetch-models.mjs");
  writeFileSync(
    script,
    `import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const home = process.env.DOCLING_RS_HOME;
console.log("models directory: " + home + "   (DOCLING_RS_HOME)");
console.log("fetching docling.rs ML dependencies from https://example.invalid");
console.log("  > .models/layout_heron.onnx");
mkdirSync(join(home, ".models"), { recursive: true });
writeFileSync(join(home, ".models", "layout_heron.onnx"), Buffer.alloc(4096, 1));
console.log("  = .models/ocr_rec.onnx (already present)");
console.log("pinned sha: " + process.env.DOCLING_DOWNLOAD_SCRIPT_SHA256 + " url: " + process.env.DOCLING_DOWNLOAD_SCRIPT_URL);
${fail ? 'console.error("error: could not fetch .models/ocr_det.onnx from any mirror"); process.exit(1);' : 'console.log("ready  home=" + home + " missing=[]");'}
`,
  );
  return script;
}

describe("models", () => {
  it("runs the fetcher with the models home, the hook and the pinned script hash, and reports files and bytes", async () => {
    const dir = tmp("kv-models-");
    const modelsDir = join(dir, "models");
    const seen: ModelsProgress[] = [];
    await installModels({ modelsDir, script: fakeFetcher(dir), hooks: HOOKS, modulesDir: join(dir, "node_modules"), nodePath: process.execPath, env: { PATH: process.env.PATH ?? "" }, scriptSha256: "abc123", onProgress: (p) => seen.push(p), pollMs: 50 });
    expect(modelsInstalled(modelsDir)).toBe(true);
    expect(seen.some((p) => p.file === ".models/layout_heron.onnx")).toBe(true);
    expect(seen.at(-1)!.bytes).toBeGreaterThanOrEqual(4096); // the layout model, plus the marker written on success
    expect(seen.at(-1)!.lines.join("\n")).toContain("pinned sha: abc123");
    expect(existsSync(join(modelsDir, "models.json"))).toBe(true); // the fetcher verified; the marker says so
    removeModels(modelsDir);
    expect(existsSync(modelsDir)).toBe(false);
  });

  it("fails with the fetcher's last lines when it exits non-zero", async () => {
    const dir = tmp("kv-models-");
    await expect(
      installModels({ modelsDir: join(dir, "models"), script: fakeFetcher(dir, true), hooks: HOOKS, modulesDir: join(dir, "node_modules"), nodePath: process.execPath, env: { PATH: process.env.PATH ?? "" } }),
    ).rejects.toThrow(/exited with code 1[\s\S]*could not fetch/);
  });

  it("does not count files alone as installed — the fetcher's verification must have passed", async () => {
    const dir = tmp("kv-models-");
    const modelsDir = join(dir, "models");
    await expect(
      installModels({ modelsDir, script: fakeFetcher(dir, true), hooks: HOOKS, modulesDir: join(dir, "node_modules"), nodePath: process.execPath, env: { PATH: process.env.PATH ?? "" } }),
    ).rejects.toThrow(/exited with code 1/);
    expect(existsSync(join(modelsDir, ".models", "layout_heron.onnx"))).toBe(true); // the files landed…
    expect(modelsInstalled(modelsDir)).toBe(false); // …but they are not "installed"
  });

  it("parses upstream's per-file lines and measures a directory", () => {
    expect(parseFetchLine("  > .models/layout_heron.onnx")).toEqual({ file: ".models/layout_heron.onnx" });
    expect(parseFetchLine("  = .models/ocr_rec.onnx (already present)")).toBeNull();
    expect(parseFetchLine("fetching docling.rs ML dependencies")).toBeNull();
    const dir = tmp("kv-bytes-");
    writeFileSync(join(dir, "a"), Buffer.alloc(100));
    writeFileSync(join(dir, "b"), Buffer.alloc(50));
    expect(dirBytes(dir)).toBe(150);
  });
});

describe("converter-hooks", () => {
  it("maps docling.rs to the installed package's entry, honouring its main, and leaves everything else alone", () => {
    const modules = tmp("kv-mods-");
    expect(entryFor("docling.rs", modules)).toBeNull();
    const pkg = join(modules, "docling.rs");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "docling.rs", main: "lib/entry.js" }));
    expect(entryFor("docling.rs", modules)).toBeNull(); // main missing on disk
    mkdirSync(join(pkg, "lib"));
    writeFileSync(join(pkg, "lib", "entry.js"), "module.exports = { marker: 'hooked' };\n");
    expect(entryFor("docling.rs", modules)).toBe(join(pkg, "lib", "entry.js"));
  });

  it("resolves a dynamic import of docling.rs inside a child started with --import", async () => {
    const modules = tmp("kv-mods-");
    mkdirSync(join(modules, "docling.rs"), { recursive: true });
    writeFileSync(join(modules, "docling.rs", "package.json"), JSON.stringify({ name: "docling.rs", main: "index.js" }));
    writeFileSync(join(modules, "docling.rs", "index.js"), "module.exports = { marker: 'hooked' };\n");
    const out = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", HOOKS, "--input-type=module", "-e", "const m = await import('docling.rs'); console.log(m.marker ?? m.default?.marker);"], {
        env: { PATH: process.env.PATH ?? "", CONVERTER_MODULES_DIR: modules },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
      child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
      child.on("close", (code) => (code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr))));
    });
    expect(out).toBe("hooked");
  });
});
