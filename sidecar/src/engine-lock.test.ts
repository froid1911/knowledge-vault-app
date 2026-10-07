import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireEngineLock, StoreInUseError } from "./engine-lock.js";
describe("engine lock", () => {
  it("takes the lock, refuses a live holder, replaces a dead one, and releases", () => {
    const d = mkdtempSync(join(tmpdir(), "kv-lock-"));
    const release = acquireEngineLock(d, process.pid, () => true);
    expect(() => acquireEngineLock(d, 424242, () => true)).toThrow(StoreInUseError); // another live process holds it
    release();
    writeFileSync(join(d, "engine.lock"), JSON.stringify({ pid: 999999, startedAt: "x" }));
    const again = acquireEngineLock(d, process.pid, () => false); // the recorded pid is dead
    again();
  });
});
