import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readLastAction, runPendingAction, takePending, writePending } from "./pending.js";
import { listBackups } from "./backups.js";
const plenty = { statfs: () => ({ available: 10 ** 12 }), now: () => "2026-10-07T12:00:00.000Z" };
function store() { const d = mkdtempSync(join(tmpdir(), "kv-pending-")); for (const s of ["reactor", "read-model", "secrets"]) mkdirSync(join(d, s)); writeFileSync(join(d, "reactor", "base"), "x"); writeFileSync(join(d, "config.json"), "{}"); return d; }
describe("pending actions", () => {
  it("is taken once", () => {
    const d = store();
    writePending(d, { action: "backup" });
    expect(takePending(d)).toEqual({ action: "backup" });
    expect(takePending(d)).toBeUndefined();
  });
  it("runs a backup, a restore and a delete-all at the next start, recording the result for the host", () => {
    const d = store();
    const made = runPendingAction(d, { action: "backup" }, "6.2.3-dev.44", plenty);
    expect(made.ok).toBe(true);
    const [backup] = listBackups(d);
    expect(JSON.parse(readFileSync(join(d, "last-action.json"), "utf8"))).toMatchObject({ action: "backup", ok: true });
    expect(readLastAction(d)).toMatchObject({ action: "backup", ok: true });
    writeFileSync(join(d, "reactor", "base"), "changed");
    expect(runPendingAction(d, { action: "restore", name: backup!.name }, "6.2.3-dev.44", plenty).ok).toBe(true);
    expect(readFileSync(join(d, "reactor", "base"), "utf8")).toBe("x");
    const gone = runPendingAction(d, { action: "delete-all", includeBackups: false }, "6.2.3-dev.44", plenty);
    expect(gone.ok).toBe(true);
    expect(existsSync(join(d, "reactor"))).toBe(false);
    expect(listBackups(d).length).toBeGreaterThan(0);
    expect(existsSync(join(d, "last-action.json"))).toBe(true); // written after the deletion, so the host can say what happened
  });
  it("reports a refused backup without throwing — the engine still starts", () => {
    const d = store();
    const r = runPendingAction(d, { action: "backup" }, "6.2.3-dev.44", { ...plenty, statfs: () => ({ available: 1 }) });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/Not enough free space/);
  });
  it("labels a requested backup with the stack that wrote the store, and prunes old ones", () => {
    const d = store();
    const r = runPendingAction(d, { action: "backup" }, "6.2.3-dev.44", { ...plenty, storeStack: "6.2.3-dev.40" });
    expect(r.ok).toBe(true);
    expect(listBackups(d)[0]!.stackVersion).toBe("6.2.3-dev.40");
  });
});
