import { spawn as nodeSpawn } from "node:child_process";
import { appendFileSync, createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { engineEnvironment } from "./environment.js";
import type { ConversionSettings } from "./settings.js";

/**
 * The conversion helper (Plan 4): the user's docling service, vendored into
 * sidecar/converter/, run by this process's own node as a child on a free
 * loopback port. It starts with nothing installed (text PDFs, Markdown, plain
 * text) and grows as the binding and models are installed (Stage B). The
 * engine is pointed at it — or at another server, or at nothing — through the
 * vault package's runtime setter, so switching needs no engine restart.
 *
 * Supervision is deliberately small: one automatic restart; a second death
 * inside the window leaves the helper `down` with its exit code and clears the
 * engine's URL, so health says "no converter" rather than timing out.
 */
export type ConverterState = "off" | "starting" | "ready" | "down";

export type ConverterStatus = {
  mode: ConversionSettings["mode"];
  /** The local helper's state; `off` also while another server or nothing is used. */
  state: ConverterState;
  /** What the engine is pointed at right now: the helper, the remote server, or nothing. */
  url: string | null;
  localUrl: string | null;
  pid: number | null;
  exitCode: number | null;
  restarts: number;
  logPath: string;
  /** The active service's own health answer, when it could be reached. */
  health: Record<string, unknown> | null;
  error: string | null;
};

export type ConverterChild = {
  pid?: number | undefined;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  stdout?: NodeJS.ReadableStream | null;
  stderr?: NodeJS.ReadableStream | null;
};

export type ConverterDeps = {
  dataDir: string;
  /** The vendored service's entry (sidecar/converter/server.ts); node strips its types. */
  entry: string;
  nodePath: string;
  /** What the helper inherits — see converterEnvironment(). */
  env: Record<string, string>;
  /** The vault package's runtime setter (null: no converter). */
  setEngineUrl: (url: string | null) => void;
  spawn?: (cmd: string, args: string[], opts: { env: Record<string, string>; stdio: ["ignore", "pipe", "pipe"] }) => ConverterChild;
  fetchImpl?: typeof fetch;
  pickPort?: () => Promise<number>;
  log?: (line: string) => void;
  now?: () => number;
  readyTimeoutMs?: number;
  readyIntervalMs?: number;
  restartWindowMs?: number;
  stopTimeoutMs?: number;
};

/** The helper inherits the OS/session allowlist only — none of the engine's matrix, none of our KV_* config. */
export function converterEnvironment(inherited: Record<string, string | undefined>): Record<string, string> {
  const env = engineEnvironment(inherited, {});
  for (const key of Object.keys(env)) if (key.startsWith("KV_")) delete env[key];
  return env;
}

export function createConverterManager(deps: ConverterDeps) {
  const spawnImpl: NonNullable<ConverterDeps["spawn"]> =
    deps.spawn ?? ((cmd, args, opts) => nodeSpawn(cmd, args, opts) as unknown as ConverterChild);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const pickPort = deps.pickPort ?? freePort;
  const log = deps.log ?? ((line: string) => console.log(`[converter] ${line}`));
  const now = deps.now ?? Date.now;
  const readyTimeoutMs = deps.readyTimeoutMs ?? 30_000;
  const readyIntervalMs = deps.readyIntervalMs ?? 200;
  const restartWindowMs = deps.restartWindowMs ?? 30_000;
  const stopTimeoutMs = deps.stopTimeoutMs ?? 5_000;
  const logPath = join(deps.dataDir, "logs", "converter.log");

  let mode: ConversionSettings["mode"] = "off";
  let remoteUrl = "";
  let state: ConverterState = "off";
  let child: ConverterChild | null = null;
  let localUrl: string | null = null;
  let exitCode: number | null = null;
  let restarts = 0;
  let lastStartAt = 0;
  let stopping = false;
  let error: string | null = null;
  let logStream: WriteStream | null = null;
  let generation = 0;

  async function start(): Promise<void> {
    if (child) return;
    const gen = ++generation;
    state = "starting";
    error = null;
    exitCode = null;
    const port = await pickPort();
    const url = `http://127.0.0.1:${port}`;
    mkdirSync(join(deps.dataDir, "logs"), { recursive: true });
    const proc = spawnImpl(deps.nodePath, [deps.entry], {
      env: {
        ...deps.env,
        CONVERT_SERVICE_HOST: "127.0.0.1",
        CONVERT_SERVICE_PORT: String(port),
        DOCLING_RS_HOME: join(deps.dataDir, "converter", "models"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child = proc;
    lastStartAt = now();
    appendFileSync(logPath, `--- ${new Date(now()).toISOString()} start pid ${proc.pid ?? "?"} port ${port}\n`);
    logStream ??= createWriteStream(logPath, { flags: "a" });
    proc.stdout?.pipe(logStream, { end: false });
    proc.stderr?.pipe(logStream, { end: false });
    proc.once("exit", (code) => {
      if (gen !== generation) return; // an older child's exit, after a restart
      onExit(code);
    });
    const deadline = now() + readyTimeoutMs;
    while (child === proc) {
      try {
        const res = await fetchImpl(`${url}/health`, { signal: AbortSignal.timeout(2_000) });
        if (res.ok) {
          localUrl = url;
          state = "ready";
          if (mode === "local") deps.setEngineUrl(url);
          log(`ready at ${url} (pid ${proc.pid ?? "?"})`);
          return;
        }
      } catch {
        // not listening yet
      }
      if (now() >= deadline) {
        error = `the converter did not answer within ${Math.round(readyTimeoutMs / 1000)} s`;
        log(error);
        generation++; // its exit is no longer "unexpected"
        proc.kill("SIGKILL");
        child = null;
        state = "down";
        deps.setEngineUrl(null);
        return;
      }
      await sleep(readyIntervalMs);
    }
  }

  function onExit(code: number | null): void {
    child = null;
    localUrl = null;
    exitCode = code;
    if (stopping) {
      state = "off";
      return;
    }
    if (now() - lastStartAt > restartWindowMs) restarts = 0; // it ran long enough to be forgiven
    if (restarts < 1) {
      restarts += 1;
      log(`exited with code ${code ?? "null"}; restarting once`);
      void start();
      return;
    }
    state = "down";
    error = `the converter exited with code ${code ?? "null"} twice within ${Math.round(restartWindowMs / 1000)} s`;
    log(error);
    deps.setEngineUrl(null);
  }

  async function stop(): Promise<void> {
    const proc = child;
    if (!proc) {
      if (state !== "down") state = "off";
      return;
    }
    stopping = true;
    const exited = new Promise<void>((resolve) => proc.once("exit", () => resolve()));
    proc.kill("SIGTERM");
    const forced = sleep(stopTimeoutMs).then(() => {
      if (child === proc) proc.kill("SIGKILL");
    });
    await Promise.race([exited, forced.then(() => exited)]);
    stopping = false;
    child = null;
    localUrl = null;
    state = "off";
  }

  async function apply(settings: ConversionSettings): Promise<void> {
    mode = settings.mode;
    remoteUrl = settings.remoteUrl;
    if (mode === "local") {
      restarts = 0;
      if (child) {
        if (state === "ready" && localUrl) deps.setEngineUrl(localUrl);
        return;
      }
      await start();
      return;
    }
    await stop();
    deps.setEngineUrl(mode === "remote" ? remoteUrl || null : null);
  }

  async function restart(): Promise<ConverterStatus> {
    restarts = 0;
    error = null;
    await stop();
    if (mode === "local") await start();
    return status();
  }

  async function status(): Promise<ConverterStatus> {
    const url = mode === "local" ? localUrl : mode === "remote" ? remoteUrl || null : null;
    let health: Record<string, unknown> | null = null;
    if (url && (mode === "remote" || state === "ready")) {
      try {
        const res = await fetchImpl(`${url}/health`, { signal: AbortSignal.timeout(2_500) });
        health = (await res.json()) as Record<string, unknown>;
      } catch {
        health = null;
      }
    }
    return { mode, state, url, localUrl, pid: child?.pid ?? null, exitCode, restarts, logPath, health, error };
  }

  return { apply, start, stop, restart, status };
}

export type ConverterManager = ReturnType<typeof createConverterManager>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A free loopback port: bind 0, read it back, release it. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("no free port"))));
    });
  });
}
