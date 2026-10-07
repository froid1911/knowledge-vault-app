import { readFileSync } from "node:fs";
import { cargoVersion, checkVersions } from "./lib/versions.mjs";

const problems = checkVersions({
  "package.json": JSON.parse(readFileSync("package.json", "utf8")).version,
  "src-tauri/Cargo.toml": cargoVersion(readFileSync("src-tauri/Cargo.toml", "utf8")),
  "src-tauri/tauri.conf.json": JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version,
});
if (problems.length) {
  console.error(`[versions] the app version disagrees:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`[versions] ${JSON.parse(readFileSync("package.json", "utf8")).version} everywhere`);
