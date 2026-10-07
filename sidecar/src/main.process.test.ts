import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Plan 5 Task 3, Step 13: the guard and the lock against the real engine binary.
 * The sidecar is built once; each case spawns `node dist/main.js` on a temp store.
 */
const SIDECAR = fileURLToPath(new URL("..", import.meta.url));
const RUNNING_STACK = (JSON.parse(readFileSync(join(SIDECAR, "node_modules/@powerhousedao/switchboard/package.json"), "utf8")) as { version: string }).version;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}
type Engine = { proc: ChildProcess; events: Promise<Record<string, unknown>[]>; exit: Promise<number | null>; waitFor: (event: string, ms: number) => Promise<Record<string, unknown>> };
async function startEngine(dataDir: string): Promise<Engine> {
  const [port, controlPort] = await Promise.all([freePort(), freePort()]);
  const proc = spawn(process.execPath, ["dist/main.js"], {
    cwd: SIDECAR,
    env: { ...process.env, KV_DATA_DIR: dataDir, KV_PORT: String(port), KV_CONTROL_PORT: String(controlPort), KV_CONTROL_TOKEN: "t", KV_HOST_ORIGIN: "http://127.0.0.1:4200", KV_STDIN_STOP: "1", KV_APP_VERSION: "0.0.0-test" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const seen: Record<string, unknown>[] = [];
  const waiters: { event: string; resolve: (e: Record<string, unknown>) => void }[] = [];
  let buffer = "";
  proc.stdout!.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (typeof parsed.event === "string") {
          seen.push(parsed);
          for (const w of waiters.splice(0)) if (w.event === parsed.event) w.resolve(parsed); else waiters.push(w);
        }
      } catch {
        // a log line
      }
    }
  });
  const exit = new Promise<number | null>((resolve) => proc.once("exit", (code) => resolve(code)));
  const events = exit.then(() => seen);
  const waitFor = (event: string, ms: number) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const found = seen.find((e) => e.event === event);
      if (found) return resolve(found);
      const timer = setTimeout(() => reject(new Error(`no ${event} line within ${ms} ms; saw ${JSON.stringify(seen)}`)), ms);
      waiters.push({ event, resolve: (e) => { clearTimeout(timer); resolve(e); } });
      void exit.then(() => { clearTimeout(timer); reject(new Error(`the engine exited before a ${event} line; saw ${JSON.stringify(seen)}`)); });
    });
  return { proc, events, exit, waitFor };
}
function store(config: Record<string, unknown>): string {
  const d = mkdtempSync(join(tmpdir(), "kv-process-"));
  mkdirSync(join(d, "secrets"), { mode: 0o700 });
  writeFileSync(join(d, "config.json"), JSON.stringify(config));
  return d;
}

describe("the engine binary: store guard and lock", () => {
  beforeAll(() => {
    execSync("bun run build", { cwd: SIDECAR, stdio: "ignore" });
  }, 120_000);

  it("refuses a store written by a newer stack with exit 78 and a fatal line naming both versions", async () => {
    const d = store({ version: 1, stackVersion: "99.0.0" });
    const e = await startEngine(d);
    expect(await e.exit).toBe(78);
    const fatal = (await e.events).find((x) => x.event === "fatal");
    expect(fatal).toMatchObject({ reason: "store-too-new" });
    expect(String(fatal!.message)).toContain("99.0.0");
    expect(String(fatal!.message)).toContain(RUNNING_STACK);
  }, 30_000);

  it("refuses a store another running engine holds (exit 78, store-in-use)", async () => {
    const d = store({ version: 1 });
    const first = await startEngine(d);
    await first.waitFor("ready", 55_000);
    try {
      const second = await startEngine(d);
      expect(await second.exit).toBe(78);
      expect((await second.events).find((x) => x.event === "fatal")).toMatchObject({ reason: "store-in-use" });
    } finally {
      first.proc.stdin!.end();
      await first.exit;
    }
  }, 90_000);

  it("backs up a store written by an older stack before opening it, then records the running stack (Review Focus 3)", async () => {
    const d = store({ version: 1, stackVersion: "6.2.3-dev.1" });
    const e = await startEngine(d);
    await e.waitFor("ready", 55_000);
    e.proc.stdin!.end(); // KV_STDIN_STOP: a closed stdin asks for a graceful stop
    expect(await e.exit).toBe(0);
    const backups = existsSync(join(d, "backups")) ? readdirSync(join(d, "backups")) : [];
    expect(backups).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(d, "backups", backups[0]!, "manifest.json"), "utf8"))).toMatchObject({ stackVersion: "6.2.3-dev.1", complete: true });
    expect(JSON.parse(readFileSync(join(d, "config.json"), "utf8"))).toMatchObject({ stackVersion: RUNNING_STACK });
    expect(existsSync(join(d, "engine.lock"))).toBe(false); // released on exit
  }, 60_000);
});
