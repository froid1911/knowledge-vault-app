import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The PDF models (~700 MB): the vendored `fetch-models.mjs` run as a child with
 * `DOCLING_RS_HOME` in app-data. It fetches upstream's download script and
 * runs it; the sidecar pins the script's sha256 so a changed upstream fails
 * closed instead of running unseen. The script needs `curl`, `sh` and `tar`.
 * Its final step imports `docling.rs` to verify the models — hence the hook
 * and the binding first.
 */
export const DOWNLOAD_SCRIPT_SHA256 = "06e59866aff3ec7b79f68a6aaae5c0ad8cdc89667f429ef53d412b6de9fd59b6"; // upstream master, 2026-10-06

export type ModelsProgress = { file: string | null; bytes: number; lines: string[] };

/** docling.rs's layout model is the one every PDF needs; its presence is "installed". */
export function modelsInstalled(modelsDir: string): boolean {
  return existsSync(join(modelsDir, ".models", "layout_heron.onnx"));
}

export function removeModels(modelsDir: string): void {
  rmSync(modelsDir, { recursive: true, force: true });
}

export function dirBytes(dir: string): number {
  let total = 0;
  const walk = (d: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      const p = join(d, name);
      try {
        const st = statSync(p);
        if (st.isDirectory()) walk(p);
        else total += st.size;
      } catch {
        // removed meanwhile
      }
    }
  };
  walk(dir);
  return total;
}

/** `  > <file>` lines name the asset being fetched; `  = <file> (already present)` is skipped. */
export function parseFetchLine(line: string): { file: string } | null {
  const m = /^\s{2}>\s+(\S.*?)\s*$/.exec(line);
  return m ? { file: m[1]! } : null;
}

export type InstallModelsOptions = {
  modelsDir: string;
  /** The vendored fetch-models.mjs. */
  script: string;
  hooks: string;
  modulesDir: string;
  nodePath: string;
  env: Record<string, string>;
  scriptSha256?: string;
  spawn?: typeof spawn;
  onProgress?: (progress: ModelsProgress) => void;
  pollMs?: number;
};

export function installModels(opts: InstallModelsOptions): Promise<void> {
  mkdirSync(opts.modelsDir, { recursive: true });
  const spawnImpl = opts.spawn ?? spawn;
  const progress = opts.onProgress ?? (() => {});
  return new Promise((resolve, reject) => {
    const child = spawnImpl(opts.nodePath, ["--import", opts.hooks, opts.script], {
      env: {
        ...opts.env,
        DOCLING_RS_HOME: opts.modelsDir,
        CONVERTER_MODULES_DIR: opts.modulesDir,
        DOCLING_DOWNLOAD_SCRIPT_SHA256: opts.scriptSha256 ?? DOWNLOAD_SCRIPT_SHA256,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const lines: string[] = [];
    let file: string | null = null;
    const report = (): void => progress({ file, bytes: dirBytes(opts.modelsDir), lines: lines.slice(-20) });
    const onLine = (line: string): void => {
      if (!line.trim()) return;
      lines.push(line);
      if (lines.length > 200) lines.shift();
      const parsed = parseFetchLine(line);
      if (parsed) file = parsed.file;
      report();
    };
    let buffer = "";
    const feed = (chunk: Buffer): void => {
      buffer += chunk.toString();
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? "";
      for (const part of parts) onLine(part);
    };
    child.stdout?.on("data", feed);
    child.stderr?.on("data", feed);
    const timer = setInterval(report, opts.pollMs ?? 1_000);
    child.on("error", (error) => {
      clearInterval(timer);
      reject(new Error(`could not run the model fetcher: ${error.message}`));
    });
    child.on("close", (code) => {
      clearInterval(timer);
      if (buffer) onLine(buffer);
      if (code === 0 && modelsInstalled(opts.modelsDir)) {
        report();
        resolve();
        return;
      }
      const tail = lines.slice(-6).join("\n");
      reject(new Error(code === 0 ? `the fetcher finished but the layout model is missing\n${tail}` : `the model fetcher exited with code ${code ?? "null"}\n${tail}`));
    });
  });
}
