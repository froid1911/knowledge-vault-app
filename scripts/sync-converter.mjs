import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { diffVendored, selectConverterFiles } from "./lib/sync-converter.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = process.env.KV_CONVERTER_SOURCE ?? join(root, "..", "docling", "src");
const target = join(root, "sidecar", "converter");
const check = process.argv.includes("--check");

if (!existsSync(source)) {
  console.error(`converter source not found: ${source} (set KV_CONVERTER_SOURCE to the docling service's src/)`);
  process.exit(2);
}
const names = selectConverterFiles(readdirSync(source));
const src = new Map(names.map((n) => [n, readFileSync(join(source, n), "utf8")]));
const vendoredNames = existsSync(target) ? selectConverterFiles(readdirSync(target)) : [];
const vendored = new Map(vendoredNames.map((n) => [n, readFileSync(join(target, n), "utf8")]));
const diff = diffVendored(src, vendored);

if (check) {
  if (diff.length) {
    console.error(`sidecar/converter differs from ${source}:\n  ${diff.join("\n  ")}\nrun: bun run sync:converter`);
    process.exit(1);
  }
  console.log(`sidecar/converter matches ${source} (${names.length} files)`);
  process.exit(0);
}
mkdirSync(target, { recursive: true });
for (const n of vendoredNames) if (!src.has(n)) rmSync(join(target, n));
for (const [n, c] of src) writeFileSync(join(target, n), c);
let commit = "unknown";
try {
  commit = execSync("git rev-parse HEAD", { cwd: join(source, ".."), encoding: "utf8" }).trim();
} catch {
  // not a git checkout: the manifest says so
}
writeFileSync(
  join(target, "SOURCE.json"),
  JSON.stringify({ source: "@powerhousedao/docling-service (../docling/src)", commit, syncedAt: new Date().toISOString(), files: names }, null, 2) + "\n",
);
console.log(`vendored ${names.length} files into sidecar/converter from ${source} @ ${commit.slice(0, 9)}${diff.length ? ` (${diff.length} changed)` : ""}`);
