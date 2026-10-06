import { chmodSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/** Spec §3.3: what the engine owns under the app-data dir. */
export const DATA_SUBDIRS = ["reactor", "read-model", "attachments", "secrets", "logs"] as const;

/**
 * Create the app-data layout. `secrets/` is 0700 (mode is applied even when the
 * directory already existed with the default mode). A `node_modules` link left
 * by earlier builds — packages are loaded by directory now — is removed so it
 * can never dangle into an EEXIST at the next launch.
 */
export function prepareDataDir(dataDir: string): void {
  for (const sub of DATA_SUBDIRS) mkdirSync(join(dataDir, sub), { recursive: true });
  if (process.platform !== "win32") chmodSync(join(dataDir, "secrets"), 0o700);
  const legacyLink = join(dataDir, "node_modules");
  let entry: ReturnType<typeof lstatSync> | undefined;
  try {
    entry = lstatSync(legacyLink);
  } catch {
    entry = undefined;
  }
  if (entry?.isSymbolicLink()) unlinkSync(legacyLink);
}
