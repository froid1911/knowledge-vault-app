import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createProtectionSwitch } from "./protection.js";
import { readLocalProtection, SettingsError } from "./settings.js";

const ADMIN = "0xAbC0000000000000000000000000000000001234";
function harness(running: { protected: boolean; adminAddress: string | null }, who: { authenticated: boolean; address?: string }) {
  const dataDir = mkdtempSync(join(tmpdir(), "kv-protection-"));
  const schedule = vi.fn();
  const sw = createProtectionSwitch({ dataDir, running, identity: { status: async () => who }, scheduleRestart: schedule });
  return { dataDir, schedule, sw };
}

describe("the protection switch", () => {
  it("refuses to protect while signed out, and protects for the signed-in user, who becomes the administrator", async () => {
    const out = harness({ protected: false, adminAddress: null }, { authenticated: false });
    await expect(out.sw.set(true)).rejects.toThrow(SettingsError);
    await expect(out.sw.set(true)).rejects.toThrow("Sign in first — protection makes your Renown identity the vaults' administrator.");
    expect(out.schedule).not.toHaveBeenCalled();
    const ok = harness({ protected: false, adminAddress: null }, { authenticated: true, address: ADMIN });
    expect(await ok.sw.set(true)).toEqual({ protected: true, adminAddress: ADMIN, restarting: true });
    expect(readLocalProtection(ok.dataDir)).toEqual({ protected: true, adminAddress: ADMIN });
    expect(ok.schedule).toHaveBeenCalledTimes(1);
  });
  it("lets only the signed-in administrator open the vaults again", async () => {
    const out = harness({ protected: true, adminAddress: ADMIN }, { authenticated: false });
    await expect(out.sw.set(false)).rejects.toThrow("Sign in as the administrator (0xAbC0…1234) to open the vaults again.");
    const other = harness({ protected: true, adminAddress: ADMIN }, { authenticated: true, address: "0x9999000000000000000000000000000000009999" });
    await expect(other.sw.set(false)).rejects.toThrow(/Sign in as the administrator/);
    expect(other.schedule).not.toHaveBeenCalled();
    const admin = harness({ protected: true, adminAddress: ADMIN }, { authenticated: true, address: ADMIN.toLowerCase() }); // addresses compare case-insensitively
    expect(await admin.sw.set(false)).toEqual({ protected: false, adminAddress: ADMIN, restarting: true });
    expect(admin.schedule).toHaveBeenCalledTimes(1);
  });
  it("asking for the state the engine already runs in writes it but restarts nothing", async () => {
    const out = harness({ protected: false, adminAddress: null }, { authenticated: true, address: ADMIN });
    expect(await out.sw.set(false)).toEqual({ protected: false, adminAddress: null, restarting: false });
    expect(out.schedule).not.toHaveBeenCalled();
    expect(out.sw.get()).toEqual({ protected: false, adminAddress: null });
  });
});
