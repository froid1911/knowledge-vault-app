import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createBackup, deleteAllData, human, restoreBackup, type BackupDeps } from "./backups.js";

/**
 * Spec §9: backups, restores and the delete-all happen with the store closed.
 * The control API records the wish, the engine restarts, and the action runs
 * at the next start — before anything opens PGlite. The result is kept for the
 * host, which shows it after the restart.
 */
export type PendingAction = { action: "backup" } | { action: "restore"; name: string } | { action: "delete-all"; includeBackups: boolean };
export type ActionResult = { action: PendingAction["action"]; ok: boolean; detail: string; at: string };

const pendingPath = (dataDir: string) => join(dataDir, "pending-action.json");
const lastPath = (dataDir: string) => join(dataDir, "last-action.json");

export function writePending(dataDir: string, action: PendingAction): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(pendingPath(dataDir), JSON.stringify(action) + "\n");
}

/** Reads and removes the pending action, so an action that crashes the start is never retried in a loop. */
export function takePending(dataDir: string): PendingAction | undefined {
  if (!existsSync(pendingPath(dataDir))) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(pendingPath(dataDir), "utf8")) as PendingAction;
    return isPendingAction(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  } finally {
    rmSync(pendingPath(dataDir), { force: true });
  }
}

export function isPendingAction(v: unknown): v is PendingAction {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  if (a.action === "backup") return true;
  if (a.action === "restore") return typeof a.name === "string" && a.name.length > 0;
  if (a.action === "delete-all") return typeof a.includeBackups === "boolean";
  return false;
}

export function readLastAction(dataDir: string): ActionResult | undefined {
  try {
    return JSON.parse(readFileSync(lastPath(dataDir), "utf8")) as ActionResult;
  } catch {
    return undefined;
  }
}

/** Runs the action; never throws — a refused backup is a result the host shows, and the engine still starts. */
export function runPendingAction(dataDir: string, action: PendingAction, stackVersion: string, deps: BackupDeps = {}): ActionResult {
  const now = deps.now ?? (() => new Date().toISOString());
  let result: ActionResult;
  try {
    if (action.action === "backup") {
      const b = createBackup(dataDir, stackVersion, deps);
      result = { action: "backup", ok: true, detail: `Backed up ${human(b.bytes)} as ${b.name}.`, at: now() };
    } else if (action.action === "restore") {
      const r = restoreBackup(dataDir, action.name, stackVersion, deps);
      result = { action: "restore", ok: true, detail: `Restored ${action.name}; what was there is kept as ${r.preRestore}.`, at: now() };
    } else {
      deleteAllData(dataDir, { includeBackups: action.includeBackups });
      result = { action: "delete-all", ok: true, detail: action.includeBackups ? "Deleted all local data, backups included." : "Deleted all local data; backups kept.", at: now() };
    }
  } catch (error) {
    result = { action: action.action, ok: false, detail: error instanceof Error ? error.message : String(error), at: now() };
  }
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(lastPath(dataDir), JSON.stringify(result, null, 2) + "\n");
  return result;
}
