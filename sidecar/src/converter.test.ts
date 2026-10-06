import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { ConverterBusyError, ConverterInputError, converterEnvironment, createConverterManager, type ConverterDeps, type Installer } from "./converter.js";
import type { BindingManifest } from "./converter/install.js";

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
    expect(h.spawns[0]).toMatchObject({ cmd: "/usr/bin/node", args: ["--import", expect.stringMatching(/converter-hooks\.mjs$/), "/app/sidecar/converter/server.ts"] });
    expect(h.spawns[0]!.env).toMatchObject({
      PATH: "/bin",
      CONVERTER_MODULES_DIR: join(h.dataDir, "converter", "node_modules"),
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

/** An installer whose state the tests control; the binding install can be held open. */
function fakeInstaller(opts: { hold?: boolean } = {}) {
  const state = { binding: null as BindingManifest | null, models: false, holdResolve: null as null | (() => void) };
  const installer: Installer = {
    installBinding: async (onProgress) => {
      onProgress({ phase: "metadata", file: "docling.rs" });
      onProgress({ phase: "downloading", file: "docling.rs-linux-x64-gnu", bytes: 42, total: 100 });
      if (opts.hold) await new Promise<void>((resolve) => (state.holdResolve = resolve));
      onProgress({ phase: "verifying", file: "docling.rs-linux-x64-gnu" });
      onProgress({ phase: "extracting", file: "docling.rs-linux-x64-gnu" });
      onProgress({ phase: "done" });
      state.binding = { version: "1.58.0", platform: "linux-x64-gnu", installedAt: "2026-10-06T00:00:00.000Z", bytes: 100 };
      return state.binding;
    },
    installModels: async (onProgress) => {
      onProgress({ file: ".models/layout_heron.onnx", bytes: 4096, lines: [] });
      state.models = true;
    },
    removeBinding: () => void (state.binding = null),
    removeModels: () => void (state.models = false),
    bindingInstalled: () => state.binding,
    modelsInstalled: () => state.models,
  };
  return { installer, state };
}
const linux = { triple: "linux-x64-gnu" as const, reason: null };

describe("converter manager — installing", () => {
  it("installs the binding as a job the status reports, then restarts the helper so it loads it", async () => {
    const { installer, state } = fakeInstaller({ hold: true });
    const h = harness({ installer, platform: linux });
    await h.manager.apply({ mode: "local", remoteUrl: "" });
    expect((await h.manager.status()).installed).toEqual({ binding: { installed: false, version: null, supported: true, platform: "linux-x64-gnu", reason: null }, models: { installed: false } });
    const started = await h.manager.install("binding");
    expect(started.job).toMatchObject({ component: "binding", phase: "downloading", percent: 42, message: "Downloading docling.rs-linux-x64-gnu — 42 %" });
    await expect(h.manager.install("models")).rejects.toBeInstanceOf(ConverterBusyError);
    state.holdResolve!();
    await tick();
    const done = await h.manager.status();
    expect(done.job).toMatchObject({ component: "binding", phase: "done", percent: 100 });
    expect(done.installed.binding).toMatchObject({ installed: true, version: "1.58.0" });
    expect(h.spawns).toHaveLength(2); // restarted, so the helper's once-per-process probe sees the binding
    expect(done.state).toBe("ready");
  });

  it("refuses the models before the binding, installs them after, and restarts the helper", async () => {
    const { installer } = fakeInstaller();
    const h = harness({ installer, platform: linux });
    await h.manager.apply({ mode: "local", remoteUrl: "" });
    await expect(h.manager.install("models")).rejects.toBeInstanceOf(ConverterInputError);
    await h.manager.install("binding");
    await tick();
    const spawnsAfterBinding = h.spawns.length;
    await h.manager.install("models");
    await tick();
    const status = await h.manager.status();
    expect(status.job).toMatchObject({ component: "models", phase: "done" });
    expect(status.installed.models.installed).toBe(true);
    expect(h.spawns.length).toBe(spawnsAfterBinding + 1);
  });

  it("names the reason on a platform without a binding, and rejects unknown components", async () => {
    const { installer } = fakeInstaller();
    const h = harness({ installer, platform: { triple: null, reason: "The converter for macOS is coming." } });
    await expect(h.manager.install("binding")).rejects.toThrow(/macOS/);
    await expect(h.manager.install("docker")).rejects.toBeInstanceOf(ConverterInputError);
    expect((await h.manager.status()).installed.binding).toMatchObject({ supported: false, reason: "The converter for macOS is coming." });
  });

  it("removing the binding stops the helper, removes it and starts the helper again without it", async () => {
    const { installer, state } = fakeInstaller();
    const h = harness({ installer, platform: linux });
    await h.manager.apply({ mode: "local", remoteUrl: "" });
    await h.manager.install("binding");
    await tick();
    const before = h.spawns.length;
    const status = await h.manager.remove("binding");
    expect(state.binding).toBeNull();
    expect(status.installed.binding.installed).toBe(false);
    expect(status.job).toBeNull();
    expect(status.state).toBe("ready");
    expect(h.spawns.length).toBe(before + 1);
    expect(h.children.at(-2)!.killed).toContain("SIGTERM");
  });

  it("records a failed install with its reason and lets the next one start", async () => {
    const { installer } = fakeInstaller();
    installer.installBinding = async () => {
      throw new Error("The download of x did not complete: ECONNRESET");
    };
    const h = harness({ installer, platform: linux });
    await h.manager.apply({ mode: "local", remoteUrl: "" });
    await h.manager.install("binding");
    await tick();
    const status = await h.manager.status();
    expect(status.job).toMatchObject({ phase: "failed", error: expect.stringMatching(/ECONNRESET/) });
    expect(h.spawns).toHaveLength(1); // no restart after a failure
    await expect(h.manager.install("binding")).resolves.toBeTruthy(); // not busy any more
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
