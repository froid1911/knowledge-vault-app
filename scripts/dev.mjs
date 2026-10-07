// Dev loop: sidecar + Vite (+ the Tauri shell) with one Ctrl+C.
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { crashWindow, restartDelayMs } from "./lib/backoff.mjs";
import { parseFatalLine, parseReadyLine, parseRestartLine, parseShutdownLine } from "./lib/ready-line.mjs";
import { protectionEnv } from "./lib/protection-env.mjs";

const noShell = process.argv.includes("--no-shell");
const fresh = process.argv.includes("--fresh"); // wipe the store first (e2e runs start from nothing)
// The e2e runs on its own store (.e2e-data): --fresh must never touch the developer's .dev-data.
const dataDirIndex = process.argv.indexOf("--data-dir");
const dataDir = resolve(dataDirIndex >= 0 && process.argv[dataDirIndex + 1] ? process.argv[dataDirIndex + 1] : ".dev-data");
const TOKEN = "dev-token";
const children = [];
const run = (cmd, args, opts = {}) => {
  const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"], ...opts });
  children.push(child);
  return child;
};

if (fresh) {
  const { rmSync } = await import("node:fs");
  rmSync(dataDir, { recursive: true, force: true });
  console.log(`[dev] fresh store: ${dataDir} removed`);
}
console.log("[dev] building and starting the sidecar…");
await new Promise((resolve, reject) => {
  const b = spawn("bun", ["run", "--cwd", "sidecar", "build"], { stdio: "inherit" });
  b.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`sidecar build failed (${code})`))));
});

const BASE_ENV = {
  KV_STDIN_STOP: "1",
  KV_DATA_DIR: dataDir,
  KV_PORT: "4201",
  KV_CONTROL_PORT: "4202",
  KV_CONTROL_TOKEN: TOKEN,
  KV_HOST_ORIGIN: "http://127.0.0.1:4200",
  KV_APP_VERSION: "dev",
};
let sidecar;
let stopping = false;
// The dev loop supervises like the shell (src-tauri/src/sidecar.rs): a crash is restarted after
// 1 s, 4 s, 16 s and a fourth within two minutes gives up; a fatal line (the engine refused to
// start, and said why) ends the loop at once; a restart line is the protection switch; a shutdown
// line is the engine stopping on request. Every engine line also goes to <dataDir>/logs/sidecar.log.
const crashes = crashWindow();
const logPath = join(dataDir, "logs", "sidecar.log");
let logStream;
function openLog(first) {
  mkdirSync(join(dataDir, "logs"), { recursive: true });
  logStream?.end();
  logStream = createWriteStream(logPath, { flags: first ? "w" : "a" });
}

/**
 * Spawn the engine with the protection section of its config.json (what the shell does in
 * production: sidecar.rs reads the same section). Resolves with the readiness line.
 */
async function startSidecar(attempt = 0) {
  let configText;
  try {
    configText = readFileSync(join(dataDir, "config.json"), "utf8");
  } catch {
    // first run
  }
  const protection = protectionEnv(configText);
  openLog(attempt === 0 && !sidecar);
  logStream.write(`--- start attempt ${attempt} ${new Date().toISOString()}\n`);
  const child = spawn("node", ["dist/main.js"], { cwd: "sidecar", stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...BASE_ENV, ...protection } });
  children.push(child);
  sidecar = child;
  let restartRequested = false;
  let shutdownRequested = false;
  let fatal = null;
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    logStream.write(chunk);
  });
  const ready = await new Promise((resolve, reject) => {
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      logStream.write(`${line}\n`);
      const r = parseReadyLine(line);
      if (r) return resolve(r); // the crash count is the two-minute window's, not a healthy start's
      const restart = parseRestartLine(line);
      if (restart) {
        restartRequested = true;
        console.log(`[dev] the engine asked to be restarted (${restart.reason})`);
        return;
      }
      const f = parseFatalLine(line);
      if (f) {
        fatal = f;
        console.error(`[dev] the engine refused to start: ${f.message}`);
        return;
      }
      if (parseShutdownLine(line)) {
        shutdownRequested = true;
        return;
      }
      process.stdout.write(`[sidecar] ${line}\n`);
    });
    child.on("exit", (code) => reject(new Error(`sidecar exited before ready (${code})${fatal ? `: ${fatal.message}` : ""}`)));
  });
  child.on("exit", (code) => {
    logStream.write(`--- exited code ${code} ${new Date().toISOString()}\n`);
    if (stopping) return;
    if (restartRequested) {
      console.log("[dev] restarting the engine…");
      startSidecar().catch((error) => console.error(`[dev] ${error.message}`));
      return;
    }
    if (shutdownRequested) {
      console.log("[dev] the engine shut down on request");
      void shutdown(0);
      return;
    }
    if (fatal) {
      console.error(`[dev] the engine will not start again until that is fixed — see ${logPath}`);
      void shutdown(1);
      return;
    }
    const n = crashes.record(Date.now());
    const delay = restartDelayMs(n);
    if (delay === null) {
      console.error(`[dev] the engine keeps stopping — see ${logPath}`);
      void shutdown(1);
      return;
    }
    console.error(`[dev] the engine crashed (code ${code}); restarting in ${delay / 1000} s (attempt ${n})`);
    setTimeout(() => startSidecar(n).catch((error) => console.error(`[dev] ${error.message}`)), delay);
  });
  console.log(`[dev] sidecar ready on ${ready.port} (control ${ready.controlPort})${protection.KV_PROTECTED ? ` — protected, administrator ${protection.KV_ADMIN_ADDRESS}` : " — open"}`);
  return ready;
}
const ready = await startSidecar();

const vite = run("bun", ["run", "--cwd", "host", "dev"], {
  env: { ...process.env, VITE_SIDECAR_PORT: String(ready.port), VITE_CONTROL_PORT: String(ready.controlPort), VITE_CONTROL_TOKEN: TOKEN },
});
vite.stdout.pipe(process.stdout);
if (!noShell) {
  await new Promise((r) => setTimeout(r, 1500));
  const shell = run("bunx", ["@tauri-apps/cli", "dev"], {
    env: { ...process.env, KV_DEV_SIDECAR_PORT: String(ready.port), KV_DEV_CONTROL_PORT: String(ready.controlPort), KV_DEV_CONTROL_TOKEN: TOKEN, KV_DEV_DATA_DIR: dataDir },
  });
  shell.stdout.pipe(process.stdout);
}

async function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  console.log("\n[dev] stopping…");
  for (const c of children) if (c !== sidecar) c.kill("SIGINT");
  if (sidecar.exitCode === null) {
    sidecar.stdin.on("error", () => {}); // EPIPE if it exits between the check and the write
    sidecar.stdin.end(); // the sidecar treats stdin EOF as a graceful-stop request
    const exited = new Promise((r) => sidecar.on("exit", r));
    const timer = new Promise((r) => setTimeout(r, 15_000, "timeout"));
    if ((await Promise.race([exited, timer])) === "timeout") sidecar.kill("SIGKILL");
  }
  logStream?.end();
  process.exit(exitCode);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
