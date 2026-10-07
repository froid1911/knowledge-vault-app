// Downloads the official Node binary for a target, verifies it against the checksum pinned in
// scripts/node-version.mjs, and writes src-tauri/binaries/kv-node-<triple>[.exe] (Tauri's external-binary
// naming; not `node`: a .deb installs external binaries into /usr/bin, where `node` belongs to the system).
//   node scripts/fetch-node.mjs [--target <triple>]   (default: this machine's rustc host triple)
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { nodeAsset, verifySha256 } from "./lib/node-dist.mjs";
import { NODE_SHA256, NODE_VERSION } from "./node-version.mjs";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const triple = arg("--target") ?? /host: (\S+)/.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))[1];
const asset = nodeAsset(NODE_VERSION, triple);
const cache = join(homedir(), ".cache", "knowledge-vault-app", "node", NODE_VERSION);
mkdirSync(cache, { recursive: true });

async function download(url, to) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(to, Buffer.from(await res.arrayBuffer()));
}

const expected = NODE_SHA256[asset.archive];
const archive = join(cache, asset.archive);
let cached = existsSync(archive);
if (cached) {
  try {
    verifySha256(archive, expected);
  } catch {
    cached = false;
  }
}
if (!cached) {
  console.log(`[fetch-node] downloading ${asset.url}`);
  await download(asset.url, archive);
  verifySha256(archive, expected);
}
console.log(`[fetch-node] ${asset.archive} verified`);
const extractTo = join(cache, "extract");
rmSync(extractTo, { recursive: true, force: true });
mkdirSync(extractTo, { recursive: true });
// `tar -xf` detects the format itself: GNU tar reads .tar.xz, and Windows' tar (bsdtar) reads the zip.
execFileSync("tar", ["-xf", archive, "-C", extractTo, asset.binary]);
const out = resolve("src-tauri", "binaries", asset.output);
mkdirSync(resolve("src-tauri", "binaries"), { recursive: true });
copyFileSync(join(extractTo, asset.binary), out);
chmodSync(out, 0o755);
console.log(`[fetch-node] ${out} (Node ${NODE_VERSION})`);
