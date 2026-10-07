// Dev loop: sidecar + Vite (+ the Tauri shell) with one Ctrl+C.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { parseReadyLine, parseRestartLine } from "./lib/ready-line.mjs";
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

/**
 * Spawn the engine with the protection section of its config.json (what the shell does in
 * production: sidecar.rs reads the same section). When the engine prints a restart line and
 * exits — the protection switch — it is started again, same ports, new environment.
 */
async function startSidecar() {
  let configText;
  try {
    configText = readFileSync(join(dataDir, "config.json"), "utf8");
  } catch {
    // first run
  }
  const protection = protectionEnv(configText);
  const child = run("node", ["dist/main.js"], { cwd: "sidecar", env: { ...process.env, ...BASE_ENV, ...protection } });
  sidecar = child;
  let restartRequested = false;
  const ready = await new Promise((resolve, reject) => {
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const r = parseReadyLine(line);
      if (r) return resolve(r);
      const restart = parseRestartLine(line);
      if (restart) {
        restartRequested = true;
        console.log(`[dev] the engine asked to be restarted (${restart.reason})`);
        return;
      }
      process.stdout.write(`[sidecar] ${line}\n`);
    });
    child.on("exit", (code) => reject(new Error(`sidecar exited before ready (${code})`)));
  });
  child.on("exit", (code) => {
    if (stopping) return;
    if (restartRequested) {
      console.log("[dev] restarting the engine…");
      startSidecar().catch((error) => console.error(`[dev] ${error.message}`));
    } else {
      console.error(`[dev] the sidecar exited (${code}); Ctrl+C to stop`);
    }
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
    env: { ...process.env, KV_DEV_SIDECAR_PORT: String(ready.port), KV_DEV_CONTROL_PORT: String(ready.controlPort), KV_DEV_CONTROL_TOKEN: TOKEN },
  });
  shell.stdout.pipe(process.stdout);
}

async function shutdown() {
  stopping = true;
  console.log("\n[dev] stopping…");
  for (const c of children) if (c !== sidecar) c.kill("SIGINT");
  if (sidecar.exitCode === null) {
    sidecar.stdin.on("error", () => {}); // EPIPE if it exits between the check and the write
    sidecar.stdin.end(); // the sidecar treats stdin EOF as a graceful-stop request
  }
  const exited = new Promise((r) => sidecar.on("exit", r));
  const timer = new Promise((r) => setTimeout(r, 15_000, "timeout"));
  if ((await Promise.race([exited, timer])) === "timeout") sidecar.kill("SIGKILL");
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
