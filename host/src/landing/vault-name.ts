export type NameCheck = { ok: true; name: string } | { ok: false; reason: string };
export const MAX_VAULT_NAME = 80;

/** A vault name as a person typed it: whitespace tidied, never empty, never absurdly long. */
export function validateVaultName(raw: string): NameCheck {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, reason: "Give the vault a name." };
  if (name.length > MAX_VAULT_NAME) return { ok: false, reason: `Keep the name under ${MAX_VAULT_NAME} characters.` };
  return { ok: true, name };
}
