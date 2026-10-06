import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { converterEnvironment, createConverterManager, type ConverterDeps } from "./converter.js";

class FakeChild extends EventEmitter {
  pid = 4242;
  exited = false;
  killed: string[] = [];
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killed.push(signal);
    setImmediate(() => this.die(null, signal));
    return true;
  }
  die(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exited) return;
    this.exited = true;
    this.emit("exit", code, signal);
  }
}

function harness(over: Partial<ConverterDeps> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "kv-conv-"));
  const children: FakeChild[] = [];
  const spawns: { cmd: string; args: string[]; env: Record<string, string> }[] = [];
  const urls: (string | null)[] = [];
  let clock = 1_000_000;
  const deps: ConverterDeps = {
    dataDir,
    entry: "/app/sidecar/converter/server.ts",
    nodePath: "/usr/bin/node",
    env: { PATH: "/bin", HOME: "/home/u" },
    setEngineUrl: (u) => urls.push(u),
    spawn: (cmd, args, opts) => {
      const c = new FakeChild();
      children.push(c);
      spawns.push({ cmd, args, env: opts.env });
      return c;
    },
    fetchImpl: async () => {
      const c = children.at(-1);
      if (c && !c.exited) return Response.json({ ok: true, backend: "pdfjs", binding: false, formats: ["pdf", "md"] });
      throw new Error("ECONNREFUSED");
    },
    pickPort: async () => 5999,
    readyIntervalMs: 2,
    readyTimeoutMs: 500,
    restartWindowMs: 30_000,
    stopTimeoutMs: 50,
    now: () => clock,
    log: () => {},
    ...over,
  };
  const manager = createConverterManager(deps);
  return { manager, children, spawns, urls, dataDir, advance: (ms: number) => (clock += ms) };
}
const tick = () => new Promise((r) => setTimeout(r, 15));

describe("converter manager", () => {
  it("starts the vendored service on a free loopback port, logs it, and points the engine at it", async () => {
    const h = harness();
    await h.manager.apply({ mode: "local", remoteUrl: "" });
    expect(h.spawns).toHaveLength(1);
    expect(h.spawns[0]).toMatchObject({ cmd: "/usr/bin/node", args: ["/app/sidecar/converter/server.ts"] });
    expect(h.spawns[0]!.env).toMatchObject({
      PATH: "/bin",
      CONVERT_SERVICE_HOST: "127.0.0.1",
      CONVERT_SERVICE_PORT: "5999",
      DOCLING_RS_HOME: join(h.dataDir, "converter", "models"),
    });
    expect(h.urls).toEqual(["http://127.0.0.1:5999"]);
    const status = await h.manager.status();
    expect(status).toMatchObject({ mode: "local", state: "ready", url: "http://127.0.0.1:5999", pid: 4242, restarts: 0 });
    expect(status.health).toMatchObject({ ok: true, binding: false });
    expect(existsSync(join(h.dataDir, "logs", "converter.log"))).toBe(true);
    await tick();
    expect(readFileSync(join(h.dataDir, "logs", "converter.log"), "utf8")).toMatch(/start pid 4242 port 5999/);
  });

  it("restarts once after an unexpected exit, then goes down and clears the engine's URL", async () => {
    const h = harness();
    await h.manager.apply({ mode: "local", remoteUrl: "" });
    h.children[0]!.die(1);
    await tick();
    expect(h.spawns).toHaveLength(2);
    expect((await h.manager.status()).state).toBe("ready");
    h.children[1]!.die(1);
    await tick();
    expect(h.spawns).toHaveLength(2);
    const status = await h.manager.status();
    expect(status).toMatchObject({ state: "down", exitCode: 1, restarts: 1, url: null });
    expect(status.error).toMatch(/twice/);
    expect(h.urls.at(-1)).toBeNull();
  });

  it("forgives a death after a long healthy run — the restart budget resets", async () => {
    const h = harness();
    await h.manager.apply({ mode: "local", remoteUrl: "" });
    h.children[0]!.die(1);
    await tick();
    h.advance(31_000);
    h.children[1]!.die(1);
    await tick();
    expect(h.spawns).toHaveLength(3);
    expect((await h.manager.status()).state).toBe("ready");
  });

  it("switches to another server: stops the helper and points the engine at the URL", async () => {
    const h = harness();
    await h.manager.apply({ mode: "local", remoteUrl: "" });
    await h.manager.apply({ mode: "remote", remoteUrl: "http://10.0.0.5:5011" });
    expect(h.children[0]!.killed).toEqual(["SIGTERM"]);
    expect(h.urls.at(-1)).toBe("http://10.0.0.5:5011");
    expect(await h.manager.status()).toMatchObject({ mode: "remote", state: "off", url: "http://10.0.0.5:5011", pid: null });
  });

  it("switches off: nothing runs and the engine has no converter", async () => {
    const h = harness();
    await h.manager.apply({ mode: "local", remoteUrl: "" });
    await h.manager.apply({ mode: "off", remoteUrl: "" });
    expect(h.urls.at(-1)).toBeNull();
    expect(await h.manager.status()).toMatchObject({ mode: "off", state: "off", url: null });
  });

  it("restart brings a down helper back with a fresh budget", async () => {
    const h = harness();
    await h.manager.apply({ mode: "local", remoteUrl: "" });
    h.children[0]!.die(1);
    await tick();
    h.children[1]!.die(1);
    await tick();
    expect((await h.manager.status()).state).toBe("down");
    const status = await h.manager.restart();
    expect(status).toMatchObject({ state: "ready", restarts: 0, url: "http://127.0.0.1:5999" });
    expect(h.spawns).toHaveLength(3);
  });

  it("gives up when the helper never answers, and says so", async () => {
    let advance = (_ms: number): void => {};
    const h = harness({
      fetchImpl: async () => {
        advance(60); // each poll costs time; the deadline is reached after a couple
        throw new Error("ECONNREFUSED");
      },
      readyTimeoutMs: 100,
    });
    advance = (ms) => void h.advance(ms);
    await h.manager.apply({ mode: "local", remoteUrl: "" });
    expect(await h.manager.status()).toMatchObject({ state: "down", url: null });
    expect((await h.manager.status()).error).toMatch(/did not answer/);
    expect(h.children[0]!.killed).toContain("SIGKILL");
  });
});

describe("converterEnvironment", () => {
  it("passes the OS and session allowlist, never the engine's matrix, secrets or our KV_* config", () => {
    const env = converterEnvironment({
      PATH: "/bin",
      HOME: "/home/u",
      DISPLAY: ":0",
      KV_DATA_DIR: "/data",
      KV_CONTROL_TOKEN: "secret",
      PH_WORKFLOWS_SECRETS_MASTER_KEY: "master",
      DATABASE_URL: "/data/read-model",
      CONVERT_SERVICE_URL: "http://elsewhere",
      SENTRY_DSN: "x",
    });
    expect(env).toEqual({ PATH: "/bin", HOME: "/home/u", DISPLAY: ":0" });
  });
});
