import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Another engine holds this store (spec §9: one engine per data dir — two would corrupt PGlite). */
export class StoreInUseError extends Error {
  constructor(public readonly pid: number) {
    super(`Another Knowledge Vault engine (pid ${pid}) is using this data folder. Close it first.`);
  }
}

const lockPath = (dataDir: string) => join(dataDir, "engine.lock");

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"; // alive, owned by someone else
  }
}

/**
 * Takes `engine.lock` for `pid`. A lock naming a live process refuses; a lock
 * left by a dead one (a crash, a SIGKILL) is replaced. Returns the release.
 */
export function acquireEngineLock(dataDir: string, pid: number, alive: (pid: number) => boolean = processAlive): () => void {
  mkdirSync(dataDir, { recursive: true });
  if (existsSync(lockPath(dataDir))) {
    let holder: number | undefined;
    try {
      holder = (JSON.parse(readFileSync(lockPath(dataDir), "utf8")) as { pid?: number }).pid;
    } catch {
      holder = undefined;
    }
    if (typeof holder === "number" && holder !== pid && alive(holder)) throw new StoreInUseError(holder);
  }
  writeFileSync(lockPath(dataDir), JSON.stringify({ pid, startedAt: new Date().toISOString() }) + "\n");
  return () => {
    try {
      const held = (JSON.parse(readFileSync(lockPath(dataDir), "utf8")) as { pid?: number }).pid;
      if (held === pid) rmSync(lockPath(dataDir), { force: true });
    } catch {
      // already gone
    }
  };
}
