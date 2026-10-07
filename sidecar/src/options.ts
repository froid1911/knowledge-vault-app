import { join } from "node:path";
import type { SidecarConfig } from "./config.js";
import { DEFAULT_RENOWN_URL } from "./identity.js";

/** The options `startSwitchboard` is called with (spec §4.1, §4.4). Pure, so the shape is testable. */
export function switchboardOptions(cfg: SidecarConfig, configFile: string, packages: readonly string[], renownUrl: string = DEFAULT_RENOWN_URL) {
  const secrets = join(cfg.dataDir, "secrets");
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
    // The engine's signing identity (spec §4.4). Open mode: an app keypair in the data dir's
    // secrets (never beside the code, which is where the default `./.ph` lands). Protected: the
    // user's delegated keypair — the one the Renown sign-in bound to their address — so every
    // local write is signed as them; it must exist, since protection required the sign-in.
    identity: cfg.protected
      ? { keypairPath: join(secrets, "user.keypair.json"), requireExisting: true, baseUrl: renownUrl }
      : { keypairPath: join(secrets, "app.keypair.json"), baseUrl: renownUrl },
  };
}
