import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BackupIncompleteError, BackupTooNewError, cleanPartialBackups, createBackup, deleteAllData, listBackups, NotEnoughSpaceError, pruneBackups, recoverInterruptedRestore, restoreBackup } from "./backups.js";

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

  it("a restore that fails while copying touches nothing: the current store stays, nothing half-made is left", () => {
    const d = store();
    const b = createBackup(d, "6.2.3-dev.44", { now: NOW, statfs: plenty });
    writeFileSync(join(d, "reactor", "base"), "changed");
    const copy = (from: string, to: string) => {
      if (from.endsWith("read-model")) throw new Error("ENOSPC: no space left on device");
      cpSync(from, to, { recursive: true });
    };
    expect(() => restoreBackup(d, b.name, "6.2.3-dev.44", { now: NOW, statfs: plenty, copy })).toThrow(/ENOSPC/);
    expect(readFileSync(join(d, "reactor", "base"), "utf8")).toBe("changed");
    expect(existsSync(join(d, "restore-staging"))).toBe(false);
    expect(existsSync(join(d, "restore-journal.json"))).toBe(false);
    expect(listBackups(d).map((x) => x.name)).toEqual([b.name]);
  });
  it("a restore interrupted while swapping is rolled back at the next start — the user's data comes back (C1)", () => {
    const d = store();
    const b = createBackup(d, "6.2.3-dev.44", { now: NOW, statfs: plenty });
    writeFileSync(join(d, "reactor", "base"), "changed");
    writeFileSync(join(d, "read-model", "base"), "changed too");
    const crashAfter = (part: string) => { if (part === "reactor") throw new Error("power cut"); };
    expect(() => restoreBackup(d, b.name, "6.2.3-dev.44", { now: NOW, statfs: plenty, afterMove: crashAfter })).toThrow(/power cut/);
    expect(existsSync(join(d, "restore-journal.json"))).toBe(true);
    // the next start: the partial-backup cleanup must not eat the pre-restore copy, and the rollback puts it back
    cleanPartialBackups(d);
    const r = recoverInterruptedRestore(d);
    expect(r).toMatchObject({ name: b.name });
    expect(readFileSync(join(d, "reactor", "base"), "utf8")).toBe("changed");
    expect(readFileSync(join(d, "read-model", "base"), "utf8")).toBe("changed too");
    expect(existsSync(join(d, "restore-journal.json"))).toBe(false);
    expect(existsSync(join(d, "restore-staging"))).toBe(false);
    expect(recoverInterruptedRestore(d)).toBeUndefined();
  });
  it("refuses a backup without its store, and one there is no room to restore", () => {
    const d = store();
    const b = createBackup(d, "6.2.3-dev.44", { now: NOW, statfs: plenty });
    rmSync(join(b.path, "read-model"), { recursive: true });
    expect(() => restoreBackup(d, b.name, "6.2.3-dev.44", { now: NOW, statfs: plenty })).toThrow(BackupIncompleteError);
    const c = createBackup(d, "6.2.3-dev.44", { now: () => "2026-10-08T12:00:00.000Z", statfs: plenty });
    expect(() => restoreBackup(d, c.name, "6.2.3-dev.44", { now: NOW, statfs: () => ({ available: 10 }) })).toThrow(NotEnoughSpaceError);
  });
  it("a restore brings the store back but keeps today's settings, sign-in and remote vaults (I3)", () => {
    const d = store();
    const b = createBackup(d, "6.2.3-dev.40", { now: NOW, statfs: plenty });
    writeFileSync(join(d, "config.json"), JSON.stringify({ version: 1, stackVersion: "6.2.3-dev.44", remoteVaults: [{ id: "r1" }], local: { protected: true, adminAddress: "0xabc" } }));
    restoreBackup(d, b.name, "6.2.3-dev.44", { now: () => "2026-10-07T13:00:00.000Z", statfs: plenty });
    const config = JSON.parse(readFileSync(join(d, "config.json"), "utf8"));
    expect(config).toMatchObject({ remoteVaults: [{ id: "r1" }], local: { protected: true, adminAddress: "0xabc" } });
    expect(config.stackVersion).toBe("6.2.3-dev.40"); // the restored store's stack, so the guard backs it up before an upgrade
    expect(readFileSync(join(d, "secrets", "llm.key"), "utf8")).toBe("sk-secret");
  });
  it("the cleanup removes only interrupted dated backups — never a pre-restore copy, never anything else", () => {
    const d = store();
    mkdirSync(join(d, "backups", "pre-restore-2026-10-07T12-00-00Z"), { recursive: true });
    mkdirSync(join(d, "backups", "my notes"));
    mkdirSync(join(d, "backups", "2026-10-09T00-00-00Z-6.2.3-dev.44"));
    expect(cleanPartialBackups(d)).toEqual(["2026-10-09T00-00-00Z-6.2.3-dev.44"]);
    expect(existsSync(join(d, "backups", "pre-restore-2026-10-07T12-00-00Z"))).toBe(true);
    expect(existsSync(join(d, "backups", "my notes"))).toBe(true);
  });
  it("lists newest first by the time each was made, and keeps the newest ten backups and three pre-restore copies", () => {
    const d = store();
    for (let i = 1; i <= 12; i++) createBackup(d, "6.2.3-dev.44", { now: () => `2026-10-${String(i).padStart(2, "0")}T12:00:00.000Z`, statfs: plenty });
    for (let i = 1; i <= 4; i++) {
      const dir = join(d, "backups", `pre-restore-2026-11-0${i}T12-00-00Z`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ name: `pre-restore-2026-11-0${i}T12-00-00Z`, stackVersion: "6.2.3-dev.44", createdAt: `2026-11-0${i}T12:00:00.000Z`, bytes: 1, complete: true }));
    }
    expect(listBackups(d)[0]!.name).toBe("pre-restore-2026-11-04T12-00-00Z");
    expect(pruneBackups(d).length).toBe(3);
    const left = listBackups(d).map((x) => x.name);
    expect(left.filter((n) => n.startsWith("pre-restore-"))).toHaveLength(3);
    expect(left.filter((n) => !n.startsWith("pre-restore-"))).toHaveLength(10);
    expect(left).not.toContain("2026-10-01T12-00-00Z-6.2.3-dev.44");
  });
});
