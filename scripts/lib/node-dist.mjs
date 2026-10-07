import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

/** Tauri target triple → Node's platform-arch name. */
const PLATFORMS = {
  "x86_64-unknown-linux-gnu": "linux-x64",
  "aarch64-unknown-linux-gnu": "linux-arm64",
  "aarch64-apple-darwin": "darwin-arm64",
  "x86_64-apple-darwin": "darwin-x64",
};

/** The official archive for a Node version and target, and where the binary sits inside it. */
export function nodeAsset(version, triple) {
  const platform = PLATFORMS[triple];
  if (!platform) throw new Error(`No Node build is bundled for target ${triple} (known: ${Object.keys(PLATFORMS).join(", ")}).`);
  const stem = `node-v${version}-${platform}`;
  return {
    archive: `${stem}.tar.xz`,
    binary: `${stem}/bin/node`,
    url: `https://nodejs.org/dist/v${version}/${stem}.tar.xz`,
    shasums: `https://nodejs.org/dist/v${version}/SHASUMS256.txt`,
  };
}

/** Throws unless the file's SHA-256 is the one SHASUMS256.txt lists for its name. */
export function verifySha256(file, shasumsText) {
  const name = basename(file);
  const line = shasumsText.split("\n").find((l) => l.trim().endsWith(`  ${name}`));
  if (!line) throw new Error(`${name} is not listed in SHASUMS256.txt.`);
  const expected = line.trim().split(/\s+/)[0];
  const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (actual !== expected) throw new Error(`${name}: checksum mismatch (expected ${expected}, got ${actual}).`);
}
