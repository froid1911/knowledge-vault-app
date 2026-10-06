import { describe, expect, it } from "vitest";
import { validateVaultName } from "./vault-name.js";

describe("validateVaultName", () => {
  it("trims and collapses whitespace", () => {
    expect(validateVaultName("  Research   notes ")).toEqual({ ok: true, name: "Research notes" });
  });
  it("refuses an empty name with a reason a person can act on", () => {
    expect(validateVaultName("   ")).toEqual({ ok: false, reason: "Give the vault a name." });
  });
  it("refuses a name over 80 characters", () => {
    const r = validateVaultName("x".repeat(81));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/80/);
  });
});
