import { join } from "node:path";
import type { SidecarConfig } from "./config.js";

/** The options `startSwitchboard` is called with (spec §4.1, §4.4). Pure, so the shape is testable. */
export function switchboardOptions(cfg: SidecarConfig, configFile: string, packages: readonly string[]) {
  return {
    configFile,
    port: cfg.port,
    strictPort: true,
    dev: false,
    mcp: true,
    workflows: { enabled: true },
    // Package directories, not names: the loader resolves names from cwd, and the engine runs with cwd = the data dir.
    packages: [...packages],
    disableLocalPackages: true,
    remoteDrives: [] as string[],
    fatalErrorShutdown: true,
    // The engine's signing identity. Open mode: an app keypair in the data dir's
    // secrets (never beside the code, which is where the default `./.ph` lands).
    identity: { keypairPath: join(cfg.dataDir, "secrets", "app.keypair.json") },
  };
}
