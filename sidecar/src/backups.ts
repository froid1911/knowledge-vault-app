import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compareVersions } from "./version.js";

/** Spec §9: what a backup holds — the store, its records, never the secrets. */
export const BACKUP_PARTS = ["reactor", "read-model", "attachments", "config.json", "pipelines.json"] as const;
export type BackupInfo = { name: string; path: string; bytes: number; stackVersion: string; createdAt: string };

export class NotEnoughSpaceError extends Error {
  constructor(
    public readonly needed: number,
    public readonly available: number,
  ) {
    super(`Not enough free space for a backup: ${human(needed)} needed, ${human(available)} available.`);
  }
}
export class BackupTooNewError extends Error {}
export class BackupNotFoundError extends Error {}

export type BackupDeps = { now?: () => string; statfs?: (dir: string) => { available: number } };

const backupsDir = (dataDir: string) => join(dataDir, "backups");
/** `2026-10-07T12:00:00.000Z` → `2026-10-07T12-00-00Z`: sortable, and legal in a file name everywhere. */
export const stamp = (iso: string): string => iso.replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");

export function human(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.ceil(bytes / 1e6)} MB`;
}
export function sizeOf(path: string): number {
  if (!existsSync(path)) return 0;
  const s = statSync(path);
  if (!s.isDirectory()) return s.size;
  return readdirSync(path).reduce((n, entry) => n + sizeOf(join(path, entry)), 0);
}
function freeSpace(dir: string): { available: number } {
  const s = statfsSync(dir);
  return { available: Number(s.bavail) * Number(s.bsize) };
}

/** Copies the store into `backups/<stamp>-<stack>/` with a manifest; refuses — before copying anything — without twice the store's size free. */
export function createBackup(dataDir: string, stackVersion: string, deps: BackupDeps = {}): BackupInfo {
  const now = deps.now ?? (() => new Date().toISOString());
  const storeBytes = BACKUP_PARTS.reduce((n, part) => n + sizeOf(join(dataDir, part)), 0);
  const { available } = (deps.statfs ?? freeSpace)(dataDir);
  if (available < storeBytes * 2) throw new NotEnoughSpaceError(storeBytes * 2, available);
  const createdAt = now();
  const name = `${stamp(createdAt)}-${stackVersion}`;
  const path = join(backupsDir(dataDir), name);
  mkdirSync(path, { recursive: true });
  for (const part of BACKUP_PARTS) {
    const from = join(dataDir, part);
    if (existsSync(from)) cpSync(from, join(path, part), { recursive: true });
  }
  const bytes = sizeOf(path);
  writeFileSync(join(path, "manifest.json"), JSON.stringify({ name, stackVersion, createdAt, bytes, complete: true }, null, 2) + "\n");
  return { name, path, bytes, stackVersion, createdAt };
}

/** A backup directory without a manifest is an interrupted copy: removed, and named. */
export function cleanPartialBackups(dataDir: string): string[] {
  if (!existsSync(backupsDir(dataDir))) return [];
  const removed: string[] = [];
  for (const name of readdirSync(backupsDir(dataDir))) {
    if (!existsSync(join(backupsDir(dataDir), name, "manifest.json"))) {
      rmSync(join(backupsDir(dataDir), name), { recursive: true, force: true });
      removed.push(name);
    }
  }
  return removed;
}

/** By name — the stamp is in it — newest first; never by file time (Review Focus 5). */
export function listBackups(dataDir: string): BackupInfo[] {
  if (!existsSync(backupsDir(dataDir))) return [];
  const out: BackupInfo[] = [];
  for (const name of readdirSync(backupsDir(dataDir))) {
    try {
      const m = JSON.parse(readFileSync(join(backupsDir(dataDir), name, "manifest.json"), "utf8")) as Partial<BackupInfo> & { complete?: boolean };
      if (m.complete) out.push({ name, path: join(backupsDir(dataDir), name), bytes: m.bytes ?? 0, stackVersion: m.stackVersion ?? "", createdAt: m.createdAt ?? "" });
    } catch {
      // not a backup
    }
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

/** Swaps the backup in; what was there is kept as `pre-restore-<stamp>` so a restore is itself undoable. */
export function restoreBackup(dataDir: string, name: string, appStack: string, deps: Pick<BackupDeps, "now"> = {}): { preRestore: string } {
  const backup = listBackups(dataDir).find((b) => b.name === name);
  if (!backup) throw new BackupNotFoundError(`No backup named ${name}.`);
  if (compareVersions(backup.stackVersion, appStack) > 0) {
    throw new BackupTooNewError(`This backup was made by a newer Knowledge Vault (stack ${backup.stackVersion}) than this one (stack ${appStack}). Download the newer version to restore it.`);
  }
  const now = deps.now ?? (() => new Date().toISOString());
  const preRestore = `pre-restore-${stamp(now())}`;
  const keep = join(backupsDir(dataDir), preRestore);
  mkdirSync(keep, { recursive: true });
  for (const part of BACKUP_PARTS) {
    const current = join(dataDir, part);
    if (existsSync(current)) renameSync(current, join(keep, part));
    const from = join(backup.path, part);
    if (existsSync(from)) cpSync(from, current, { recursive: true });
  }
  writeFileSync(join(keep, "manifest.json"), JSON.stringify({ name: preRestore, stackVersion: appStack, createdAt: now(), bytes: sizeOf(keep), complete: true }, null, 2) + "\n");
  return { preRestore };
}

/** Everything under the data dir goes — the app returns to first run — except the backups unless asked. */
export function deleteAllData(dataDir: string, opts: { includeBackups: boolean }): void {
  if (!existsSync(dataDir)) return;
  for (const entry of readdirSync(dataDir)) {
    if (entry === "backups" && !opts.includeBackups) continue;
    rmSync(join(dataDir, entry), { recursive: true, force: true });
  }
}
