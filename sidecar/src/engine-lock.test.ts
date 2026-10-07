import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireEngineLock, StoreInUseError } from "./engine-lock.js";

const engine = { alive: () => true, command: () => "node /app/sidecar/dist/main.js", bootTime: () => 1_000_000 };
describe("engine lock", () => {
  it("takes the lock, refuses a live engine holding it, replaces a dead one, and releases", () => {
    const d = mkdtempSync(join(tmpdir(), "kv-lock-"));
    const release = acquireEngineLock(d, process.pid, engine);
    expect(JSON.parse(readFileSync(join(d, "engine.lock"), "utf8"))).toMatchObject({ pid: process.pid, bootTime: 1_000_000 });
    expect(() => acquireEngineLock(d, 424242, engine)).toThrow(StoreInUseError);
    release();
    writeFileSync(join(d, "engine.lock"), JSON.stringify({ pid: 999999, bootTime: 1_000_000 }));
    acquireEngineLock(d, process.pid, { ...engine, alive: () => false })();
  });
  it("does not trust a pid from another boot, or one that is now another program (I2)", () => {
    const d = mkdtempSync(join(tmpdir(), "kv-lock-"));
    writeFileSync(join(d, "engine.lock"), JSON.stringify({ pid: 4242, bootTime: 500_000 })); // before a reboot
    acquireEngineLock(d, process.pid, engine)();
    writeFileSync(join(d, "engine.lock"), JSON.stringify({ pid: 4242, bootTime: 1_000_000 }));
    acquireEngineLock(d, process.pid, { ...engine, command: () => "/usr/bin/firefox" })(); // the pid was reused
    writeFileSync(join(d, "engine.lock"), JSON.stringify({ pid: 4242, bootTime: 1_000_000 }));
    expect(() => acquireEngineLock(d, process.pid, { ...engine, command: () => undefined })).toThrow(StoreInUseError); // cannot tell: refuse
  });
});
