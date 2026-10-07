import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The converter helper is the engine's child; an engine that dies by SIGKILL
 * leaves it running (seen live: four orphaned helpers). Its pid is recorded
 * when it starts, and the next engine stops a recorded helper that is still
 * alive before starting its own.
 */
const pidPath = (dataDir: string) => join(dataDir, "converter", "helper.pid");

export function writeHelperPid(dataDir: string, pid: number): void {
  mkdirSync(join(dataDir, "converter"), { recursive: true });
  writeFileSync(pidPath(dataDir), JSON.stringify({ pid }) + "\n");
}
export function clearHelperPid(dataDir: string): void {
  rmSync(pidPath(dataDir), { force: true });
}
export function readHelperPid(dataDir: string): number | undefined {
  if (!existsSync(pidPath(dataDir))) return undefined;
  try {
    const pid = (JSON.parse(readFileSync(pidPath(dataDir), "utf8")) as { pid?: unknown }).pid;
    return typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Stops a recorded helper that is still running; forgets the record either way. Returns the pid it stopped. */
export function stopOrphanedHelper(
  dataDir: string,
  deps: { alive?: (pid: number) => boolean; kill?: (pid: number) => void } = {},
): number | undefined {
  const pid = readHelperPid(dataDir);
  clearHelperPid(dataDir);
  if (pid === undefined) return undefined;
  const alive = deps.alive ?? processAlive;
  if (!alive(pid)) return undefined;
  const kill = deps.kill ?? ((p: number) => process.kill(p, "SIGTERM"));
  try {
    kill(pid);
  } catch {
    return undefined;
  }
  return pid;
}
