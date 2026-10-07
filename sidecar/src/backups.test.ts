import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BackupTooNewError, cleanPartialBackups, createBackup, deleteAllData, listBackups, NotEnoughSpaceError, restoreBackup } from "./backups.js";

function store(): string {
  const d = mkdtempSync(join(tmpdir(), "kv-backups-"));
  for (const sub of ["reactor", "read-model", "attachments", "secrets", "logs"]) mkdirSync(join(d, sub));
  writeFileSync(join(d, "reactor", "base"), "x".repeat(1000));
  writeFileSync(join(d, "read-model", "base"), "y".repeat(500));
  writeFileSync(join(d, "secrets", "llm.key"), "sk-secret");
  writeFileSync(join(d, "config.json"), JSON.stringify({ version: 1, stackVersion: "6.2.3-dev.44" }));
  writeFileSync(join(d, "pipelines.json"), "{}");
  return d;
}
const plenty = () => ({ available: 10 ** 12 });
const NOW = () => "2026-10-07T12:00:00.000Z";

describe("backups", () => {
  it("copies the store — never the secrets — into a named folder with a manifest", () => {
    const d = store();
    const b = createBackup(d, "6.2.3-dev.44", { now: NOW, statfs: plenty });
    expect(b.name).toBe("2026-10-07T12-00-00Z-6.2.3-dev.44");
    expect(existsSync(join(b.path, "reactor", "base"))).toBe(true);
    expect(existsSync(join(b.path, "read-model", "base"))).toBe(true);
    expect(existsSync(join(b.path, "config.json"))).toBe(true);
    expect(existsSync(join(b.path, "secrets"))).toBe(false);
    expect(JSON.parse(readFileSync(join(b.path, "manifest.json"), "utf8"))).toMatchObject({ stackVersion: "6.2.3-dev.44", createdAt: NOW(), complete: true });
    expect(b.bytes).toBeGreaterThan(1500);
  });
  it("refuses without room, before copying anything (Review Focus 2)", () => {
    const d = store();
    expect(() => createBackup(d, "6.2.3-dev.44", { now: NOW, statfs: () => ({ available: 100 }) })).toThrow(NotEnoughSpaceError);
    expect(existsSync(join(d, "backups"))).toBe(false);
  });
  it("lists by name (Review Focus 5) and cleans a partial backup", () => {
    const d = store();
    createBackup(d, "6.2.3-dev.44", { now: () => "2026-10-07T12:00:00.000Z", statfs: plenty });
    createBackup(d, "6.2.3-dev.44", { now: () => "2026-10-08T09:00:00.000Z", statfs: plenty });
    mkdirSync(join(d, "backups", "2026-10-09T00-00-00Z-6.2.3-dev.44")); // interrupted: no manifest
    expect(cleanPartialBackups(d)).toEqual(["2026-10-09T00-00-00Z-6.2.3-dev.44"]);
    expect(listBackups(d).map((b) => b.name)).toEqual(["2026-10-08T09-00-00Z-6.2.3-dev.44", "2026-10-07T12-00-00Z-6.2.3-dev.44"]);
  });
  it("restores a backup, keeping what was there under pre-restore, and refuses one from a newer stack", () => {
    const d = store();
    const b = createBackup(d, "6.2.3-dev.44", { now: NOW, statfs: plenty });
    writeFileSync(join(d, "reactor", "base"), "changed");
    const r = restoreBackup(d, b.name, "6.2.3-dev.44", { now: () => "2026-10-07T13:00:00.000Z" });
    expect(readFileSync(join(d, "reactor", "base"), "utf8")).toBe("x".repeat(1000));
    expect(readFileSync(join(d, "backups", r.preRestore, "reactor", "base"), "utf8")).toBe("changed");
    const newer = createBackup(d, "6.2.3-dev.50", { now: () => "2026-10-07T14:00:00.000Z", statfs: plenty });
    expect(() => restoreBackup(d, newer.name, "6.2.3-dev.44", { now: NOW })).toThrow(BackupTooNewError);
  });
  it("delete-all keeps the backups unless told otherwise, and secrets never survive", () => {
    const d = store();
    createBackup(d, "6.2.3-dev.44", { now: NOW, statfs: plenty });
    deleteAllData(d, { includeBackups: false });
    expect(existsSync(join(d, "reactor"))).toBe(false);
    expect(existsSync(join(d, "secrets"))).toBe(false);
    expect(existsSync(join(d, "config.json"))).toBe(false);
    expect(listBackups(d)).toHaveLength(1);
    deleteAllData(d, { includeBackups: true });
    expect(existsSync(join(d, "backups"))).toBe(false);
  });
});
