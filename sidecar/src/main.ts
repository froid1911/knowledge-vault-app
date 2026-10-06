import { chmodSync, existsSync, readFileSync } from "node:fs";
import { register } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readSidecarConfig, switchboardEnv } from "./config.js";
import { createControlServer } from "./control.js";
import { prepareDataDir } from "./data-dir.js";
import { applyEnvironment, engineEnvironment } from "./environment.js";
import { switchboardOptions } from "./options.js";
import { readyLine, waitForHealth } from "./ready.js";
import { ensureSecret } from "./secrets.js";
import { readSettings, writeSettings } from "./settings.js";
import { createVaultDrive, deleteVaultDrive, ensureWorkflowsDrive, listVaultDrives, renameVaultDrive } from "./vaults.js";

// The data-dir storage swap must be registered before the Switchboard (and
// through it @powerhousedao/pglite-fs) is imported — hence the dynamic import below.
register(new URL("./nodefs-hooks.mjs", import.meta.url));

/**
 * The two packages the engine loads, as directories (spec §4.1). The loader
 * resolves a bare name from cwd/node_modules, and the engine runs with cwd =
 * the data dir; a directory needs no cwd and no link into app-data.
 */
const PACKAGE_DIRS = ["@powerhousedao/knowledge-note", "@powerhousedao/workflow"].map((name) =>
  fileURLToPath(new URL(`../node_modules/${name}`, import.meta.url)),
);

/** The version in a package directory's manifest, for About and Diagnostics. */
function packageVersion(dir: string): string {
  try {
    return (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
}
const STACK_VERSION = packageVersion(fileURLToPath(new URL("../node_modules/@powerhousedao/switchboard", import.meta.url)));
const VAULT_PACKAGE_VERSION = packageVersion(PACKAGE_DIRS[0]!);

async function main(): Promise<void> {
  const cfg = readSidecarConfig(process.env);
  cfg.dataDir = resolve(cfg.dataDir); // relative values (the dev loop's) resolve against cwd = sidecar/
  // Everything the engine creates — PGlite files, logs, the SDK's .ph — is private to the user.
  process.umask(0o077);
  prepareDataDir(cfg.dataDir);
  const workflowsKey = ensureSecret(join(cfg.dataDir, "secrets", "workflows.key"));
  // Spec §4.2: the engine's environment is the matrix plus an OS/session allowlist. Nothing else is inherited.
  applyEnvironment(process.env, engineEnvironment(process.env, switchboardEnv(cfg, workflowsKey)));
  const configFile = fileURLToPath(new URL("../powerhouse.config.json", import.meta.url));
  // cwd = the data dir, so anything written relative to cwd (the Renown SDK's
  // `./.ph`, the registry cache) lands in app-data, never beside the code.
  process.chdir(cfg.dataDir);

  // A missing package directory would degrade to an engine without the vault (the loader logs a miss and goes on); fail loudly instead.
  for (const dir of PACKAGE_DIRS) {
    if (!existsSync(dir)) throw new Error(`package directory missing: ${dir} (run \`bun install\` in sidecar/)`);
  }
  const { startSwitchboard } = await import("@powerhousedao/switchboard/server");
  const options = switchboardOptions(cfg, configFile, PACKAGE_DIRS);
  const switchboard = await startSwitchboard(options);
  // The SDK writes the keypair world-readable; it is a secret.
  if (existsSync(options.identity.keypairPath)) chmodSync(options.identity.keypairPath, 0o600);
  const origin = `http://127.0.0.1:${switchboard.port}`;
  await waitForHealth(`${origin}/health`, { timeoutMs: 60_000, intervalMs: 250 });

  const control = createControlServer({
    token: cfg.controlToken,
    hostOrigin: cfg.hostOrigin,
    status: () => ({
      ok: true,
      port: switchboard.port,
      controlPort: cfg.controlPort,
      appVersion: cfg.appVersion,
      protected: cfg.protected,
      dataDir: cfg.dataDir,
      stackVersion: STACK_VERSION,
      vaultPackageVersion: VAULT_PACKAGE_VERSION,
    }),
    listVaults: () => listVaultDrives(origin),
    createVault: (name) => createVaultDrive(origin, name),
    renameVault: (id, name) => renameVaultDrive(origin, id, name),
    deleteVault: (id) => deleteVaultDrive(origin, id),
    workflowsDrive: () => ensureWorkflowsDrive(origin),
    readSettings: () => readSettings(cfg.dataDir),
    writeSettings: (patch) => writeSettings(cfg.dataDir, patch),
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
