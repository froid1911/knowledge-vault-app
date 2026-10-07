// Downloads the official Node binary for a target, verifies it against SHASUMS256.txt, and writes
// src-tauri/binaries/node-<triple> (Tauri's external-binary naming).
//   node scripts/fetch-node.mjs [--target <triple>]   (default: this machine's rustc host triple)
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { nodeAsset, verifySha256 } from "./lib/node-dist.mjs";
import { NODE_VERSION } from "./node-version.mjs";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const triple = arg("--target") ?? /host: (\S+)/.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))[1];
const asset = nodeAsset(NODE_VERSION, triple);
const cache = join(homedir(), ".cache", "desktop-knowledge-vault", "node", NODE_VERSION);
mkdirSync(cache, { recursive: true });

async function download(url, to) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(to, Buffer.from(await res.arrayBuffer()));
}

const sumsPath = join(cache, "SHASUMS256.txt");
if (!existsSync(sumsPath)) await download(asset.shasums, sumsPath);
const { readFileSync } = await import("node:fs");
const sums = readFileSync(sumsPath, "utf8");
const archive = join(cache, asset.archive);
let cached = existsSync(archive);
if (cached) {
  try {
    verifySha256(archive, sums);
  } catch {
    cached = false;
  }
}
if (!cached) {
  console.log(`[fetch-node] downloading ${asset.url}`);
  await download(asset.url, archive);
  verifySha256(archive, sums);
}
console.log(`[fetch-node] ${asset.archive} verified`);
const extractTo = join(cache, "extract");
rmSync(extractTo, { recursive: true, force: true });
mkdirSync(extractTo, { recursive: true });
execFileSync("tar", ["-xJf", archive, "-C", extractTo, asset.binary]);
const out = resolve("src-tauri", "binaries", `node-${triple}`);
mkdirSync(resolve("src-tauri", "binaries"), { recursive: true });
copyFileSync(join(extractTo, asset.binary), out);
chmodSync(out, 0o755);
console.log(`[fetch-node] ${out} (Node ${NODE_VERSION})`);
