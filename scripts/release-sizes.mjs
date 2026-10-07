// Release workflow, last job: rewrite the release notes with one table of the installers' sizes.
//   node scripts/release-sizes.mjs <tag>   (needs GH_TOKEN; uses the gh CLI)
import { execFileSync } from "node:child_process";
import { withSizes } from "./lib/release-notes.mjs";

const tag = process.argv[2];
const release = JSON.parse(execFileSync("gh", ["release", "view", tag, "--json", "body,assets"], { encoding: "utf8" }));
execFileSync("gh", ["release", "edit", tag, "--notes", withSizes(release.body ?? "", release.assets ?? [])], { stdio: "inherit" });
