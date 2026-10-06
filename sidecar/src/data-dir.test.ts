import { existsSync, lstatSync, mkdtempSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DATA_SUBDIRS, prepareDataDir } from "./data-dir.js";

describe("prepareDataDir", () => {
  it("creates the layout with a private secrets dir and removes a leftover node_modules link", () => {
    const dir = mkdtempSync(join(tmpdir(), "kv data äö-"));
    symlinkSync("/nowhere/that/exists", join(dir, "node_modules")); // the Phase 0 link, now dangling
    prepareDataDir(dir);
    for (const sub of DATA_SUBDIRS) expect(existsSync(join(dir, sub)), sub).toBe(true);
    if (process.platform !== "win32") expect(statSync(join(dir, "secrets")).mode & 0o777).toBe(0o700);
    expect(() => lstatSync(join(dir, "node_modules"))).toThrow(/ENOENT/);
    prepareDataDir(dir); // idempotent
    expect(existsSync(join(dir, "reactor"))).toBe(true);
  });
});
