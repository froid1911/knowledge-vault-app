/**
 * The sidecar's protection variables from config.json's `local` section
 * (spec §4.4) — what the shell derives in Rust (config.rs LocalProtection),
 * for the dev loop. Protected without an administrator cannot start the
 * engine, so it counts as open; so does a missing or unreadable file.
 */
export function protectionEnv(configText) {
  if (!configText) return {};
  try {
    const v = JSON.parse(configText);
    const local = v && typeof v === "object" ? v.local : undefined;
    if (local && local.protected === true && typeof local.adminAddress === "string" && local.adminAddress) {
      return { KV_PROTECTED: "1", KV_ADMIN_ADDRESS: local.adminAddress };
    }
  } catch {
    // broken JSON: open
  }
  return {};
}
