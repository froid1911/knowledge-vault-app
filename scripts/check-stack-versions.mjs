import { readFileSync } from "node:fs";
import { checkStackVersions } from "./lib/stack-versions.mjs";
const EXPECTED = "6.2.3-dev.44";
const manifests = ["host", "sidecar"].map((dir) => {
  const p = JSON.parse(readFileSync(new URL(`../${dir}/package.json`, import.meta.url), "utf8"));
  return { name: dir, deps: { ...p.dependencies, ...p.devDependencies } };
});
const problems = checkStackVersions(manifests, EXPECTED);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`stack ${EXPECTED} pinned in ${manifests.length} workspaces`);
