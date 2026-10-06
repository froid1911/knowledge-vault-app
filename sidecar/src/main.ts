import { mkdirSync } from "node:fs";
import { register } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readSidecarConfig, switchboardEnv } from "./config.js";
import { createControlServer } from "./control.js";
import { readyLine, waitForHealth } from "./ready.js";
import { ensureSecret } from "./secrets.js";
import { createVaultDrive, listVaultDrives } from "./vaults.js";

// The data-dir storage swap must be registered before the Switchboard (and
// through it @powerhousedao/pglite-fs) is imported — hence the dynamic import below.
register(new URL("./nodefs-hooks.mjs", import.meta.url));

async function main(): Promise<void> {
  const cfg = readSidecarConfig(process.env);
  cfg.dataDir = resolve(cfg.dataDir); // relative values (the dev loop's ../.dev-data) resolve against cwd = sidecar/
  for (const sub of ["reactor", "read-model", "attachments", "secrets", "logs"]) {
    mkdirSync(join(cfg.dataDir, sub), { recursive: true });
  }
  const workflowsKey = ensureSecret(join(cfg.dataDir, "secrets", "workflows.key"));
  Object.assign(process.env, switchboardEnv(cfg, workflowsKey));
  // cwd stays sidecar/ (the shell and the dev loop spawn us there): package
  // names resolve through the workspace's node_modules, and the config file is
  // named explicitly so nothing depends on what else cwd contains.
  const configFile = fileURLToPath(new URL("../powerhouse.config.json", import.meta.url));

  const { startSwitchboard } = await import("@powerhousedao/switchboard/server");
  const switchboard = await startSwitchboard({
    configFile,
    port: cfg.port,
    strictPort: true,
    dev: false,
    mcp: true,
    workflows: { enabled: true },
    packages: ["@powerhousedao/knowledge-note", "@powerhousedao/workflow"],
    disableLocalPackages: true,
    remoteDrives: [],
    fatalErrorShutdown: true,
  });
  const origin = `http://127.0.0.1:${switchboard.port}`;
  await waitForHealth(`${origin}/health`, { timeoutMs: 60_000, intervalMs: 250 });

  const control = createControlServer({
    token: cfg.controlToken,
    hostOrigin: cfg.hostOrigin,
    status: () => ({ ok: true, port: switchboard.port, controlPort: cfg.controlPort, appVersion: cfg.appVersion, protected: cfg.protected }),
    listVaults: () => listVaultDrives(origin),
    createVault: (name) => createVaultDrive(origin, name),
  });
  const controlPort = await control.listen(cfg.controlPort);
  process.stdout.write(readyLine(switchboard.port, controlPort) + "\n");

  // The shell and the dev loop set KV_STDIN_STOP=1 and keep our stdin open:
  // closing it (or writing `stop`) asks for a graceful stop, and SIGINT runs
  // the Switchboard's own shutdown (PGlite flush, drained API). Without the
  // flag stdin is ignored, so a launch with a closed stdin keeps running.
  if (process.env.KV_STDIN_STOP === "1") {
    process.stdin.resume();
    process.stdin.on("end", () => process.kill(process.pid, "SIGINT"));
    process.stdin.on("data", (chunk) => {
      if (String(chunk).trim() === "stop") process.kill(process.pid, "SIGINT");
    });
  }
  process.on("SIGINT", () => void control.close());
}

main().catch((error) => {
  console.error(`[sidecar] failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
