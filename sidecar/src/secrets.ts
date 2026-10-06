import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Read a secret file or create it (32 random bytes, hex) with mode 0600. */
export function ensureSecret(path: string): string {
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const value = randomBytes(32).toString("hex");
  writeFileSync(path, value, { mode: 0o600 });
  chmodSync(path, 0o600);
  return value;
}
