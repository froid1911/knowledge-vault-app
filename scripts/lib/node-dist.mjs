import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

/** Tauri target triple → Node's platform-arch name. */
const PLATFORMS = {
  "x86_64-unknown-linux-gnu": "linux-x64",
  "aarch64-unknown-linux-gnu": "linux-arm64",
  "aarch64-apple-darwin": "darwin-arm64",
  "x86_64-apple-darwin": "darwin-x64",
  "x86_64-pc-windows-msvc": "win-x64",
};

/**
 * The official archive for a Node version and target, where the binary sits inside it, and the
 * file Tauri expects as the external binary (`kv-node-<triple>`, `.exe` on Windows). Windows
 * builds are a zip with node.exe at the top; the others a tar.xz with bin/node.
 */
export function nodeAsset(version, triple) {
  const platform = PLATFORMS[triple];
  if (!platform) throw new Error(`No Node build is bundled for target ${triple} (known: ${Object.keys(PLATFORMS).join(", ")}).`);
  const stem = `node-v${version}-${platform}`;
  const windows = triple.includes("windows");
  const archive = windows ? `${stem}.zip` : `${stem}.tar.xz`;
  return {
    archive,
    binary: windows ? `${stem}/node.exe` : `${stem}/bin/node`,
    url: `https://nodejs.org/dist/v${version}/${archive}`,
    output: `kv-node-${triple}${windows ? ".exe" : ""}`,
  };
}

/** Throws unless the file's SHA-256 is the pinned one (scripts/node-version.mjs). */
export function verifySha256(file, expected) {
  const name = basename(file);
  if (!expected) throw new Error(`${name}: no pinned checksum (add it to scripts/node-version.mjs).`);
  const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (actual !== expected) throw new Error(`${name}: checksum mismatch (expected ${expected}, got ${actual}).`);
}
