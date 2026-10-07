import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readHelperPid, stopOrphanedHelper, writeHelperPid } from "./orphans.js";
describe("orphaned converter helper", () => {
  it("records the helper's pid, stops a live orphan at the next start, ignores a dead one", () => {
    const d = mkdtempSync(join(tmpdir(), "kv-orphans-"));
    mkdirSync(join(d, "converter"));
    writeHelperPid(d, 4242);
    expect(readHelperPid(d)).toBe(4242);
    expect(JSON.parse(readFileSync(join(d, "converter", "helper.pid"), "utf8"))).toEqual({ pid: 4242 });
    const killed: number[] = [];
    expect(stopOrphanedHelper(d, { alive: () => true, kill: (pid) => { killed.push(pid); } })).toBe(4242);
    expect(killed).toEqual([4242]);
    expect(readHelperPid(d)).toBeUndefined(); // the file is gone once handled
    writeHelperPid(d, 5151);
    expect(stopOrphanedHelper(d, { alive: () => false, kill: () => { throw new Error("must not"); } })).toBeUndefined();
    expect(stopOrphanedHelper(d, { alive: () => true, kill: () => {} })).toBeUndefined(); // nothing recorded
  });
});
