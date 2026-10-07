import { readLocalProtection, SettingsError, writeLocalProtection, type LocalProtection } from "./settings.js";

export type ProtectionSwitchDeps = {
  dataDir: string;
  /** What this engine runs as (its environment), as opposed to what config.json says for the next start. */
  running: { protected: boolean; adminAddress: string | null | undefined };
  identity: { status: () => Promise<{ authenticated: boolean; address?: string }> };
  /** Called once when the engine must restart for the new setting (main.ts prints the restart line and shuts down). */
  scheduleRestart: () => void;
};

const shortAddress = (address: string) => (address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address);
const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * Spec §4.4: one switch for every local vault. Protecting needs the signed-in
 * identity, which becomes the administrator; opening the vaults again is the
 * administrator's call — anyone else at the keyboard (or holding the control
 * token) cannot flip a protected engine back to open. The trade-off: an
 * administrator whose credential expired signs in again first (Renown must be
 * reachable), exactly as any protected system asks.
 */
export function createProtectionSwitch(deps: ProtectionSwitchDeps) {
  return {
    get: (): LocalProtection => readLocalProtection(deps.dataDir),
    async set(wanted: boolean): Promise<LocalProtection & { restarting: boolean }> {
      const current = readLocalProtection(deps.dataDir);
      const who = await deps.identity.status();
      // The administrator stays on record when the vaults are opened again.
      let adminAddress = current.adminAddress ?? deps.running.adminAddress ?? null;
      if (wanted) {
        if (!who.authenticated || !who.address) throw new SettingsError("Sign in first — protection makes your Renown identity the vaults' administrator.");
        adminAddress = who.address;
      } else if (deps.running.protected || current.protected) {
        const admin = deps.running.adminAddress ?? current.adminAddress;
        if (admin && !(who.authenticated && same(who.address, admin))) {
          throw new SettingsError(`Sign in as the administrator (${shortAddress(admin)}) to open the vaults again.`);
        }
      }
      const written = writeLocalProtection(deps.dataDir, { protected: wanted, adminAddress });
      const restarting = written.protected !== deps.running.protected || (wanted && !same(adminAddress, deps.running.adminAddress));
      if (restarting) deps.scheduleRestart();
      return { ...written, restarting };
    },
  };
}
