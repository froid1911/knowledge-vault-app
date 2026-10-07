import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readHelperPid, stopOrphanedHelper, writeHelperPid } from "./orphans.js";

const helper = { alive: () => true, command: () => "node --import hooks.mjs /app/sidecar/converter/server.ts", bootTime: () => 1_000_000 };
describe("orphaned converter helper", () => {
  it("records the helper's pid with the boot, stops a live orphan at the next start, ignores a dead one", () => {
    const d = mkdtempSync(join(tmpdir(), "kv-orphans-"));
    mkdirSync(join(d, "converter"));
    writeHelperPid(d, 4242, helper.bootTime);
    expect(readHelperPid(d)).toBe(4242);
    expect(JSON.parse(readFileSync(join(d, "converter", "helper.pid"), "utf8"))).toEqual({ pid: 4242, bootTime: 1_000_000 });
    const killed: number[] = [];
    expect(stopOrphanedHelper(d, { ...helper, kill: (pid) => { killed.push(pid); } })).toBe(4242);
    expect(killed).toEqual([4242]);
    expect(readHelperPid(d)).toBeUndefined();
    writeHelperPid(d, 5151, helper.bootTime);
    expect(stopOrphanedHelper(d, { ...helper, alive: () => false, kill: () => { throw new Error("must not"); } })).toBeUndefined();
    expect(stopOrphanedHelper(d, { ...helper, kill: () => {} })).toBeUndefined();
  });
  it("never signals a process that is not the helper — another boot, another program, or one it cannot identify (I2)", () => {
    const d = mkdtempSync(join(tmpdir(), "kv-orphans-"));
    const must = { kill: () => { throw new Error("signalled an unrelated process"); } };
    writeHelperPid(d, 4242, () => 500_000);
    expect(stopOrphanedHelper(d, { ...helper, ...must })).toBeUndefined();
    writeHelperPid(d, 4242, helper.bootTime);
    expect(stopOrphanedHelper(d, { ...helper, command: () => "/usr/bin/vim notes.md", ...must })).toBeUndefined();
    writeHelperPid(d, 4242, helper.bootTime);
    expect(stopOrphanedHelper(d, { ...helper, command: () => undefined, ...must })).toBeUndefined();
  });
});
