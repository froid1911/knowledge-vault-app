// Dev loop: sidecar + Vite (+ the Tauri shell) with one Ctrl+C.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { parseReadyLine } from "./lib/ready-line.mjs";

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
const sidecar = run("node", ["dist/main.js"], {
  cwd: "sidecar",
  env: {
    ...process.env,
    KV_STDIN_STOP: "1",
    KV_DATA_DIR: dataDir,
    KV_PORT: "4201",
    KV_CONTROL_PORT: "4202",
    KV_CONTROL_TOKEN: TOKEN,
    KV_HOST_ORIGIN: "http://127.0.0.1:4200",
    KV_APP_VERSION: "dev",
  },
});
const ready = await new Promise((resolve, reject) => {
  const rl = createInterface({ input: sidecar.stdout });
  rl.on("line", (line) => {
    const r = parseReadyLine(line);
    if (r) resolve(r);
    else process.stdout.write(`[sidecar] ${line}\n`);
  });
  sidecar.on("exit", (code) => reject(new Error(`sidecar exited before ready (${code})`)));
});
console.log(`[dev] sidecar ready on ${ready.port} (control ${ready.controlPort})`);

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
