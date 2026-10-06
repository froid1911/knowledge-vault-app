// Every @powerhousedao/* package and document-model must share one stack version.
const EXEMPT = new Set(["@powerhousedao/knowledge-note", "@powerhousedao/document-engineering"]);
export function isStackPackage(name) {
  return (name.startsWith("@powerhousedao/") || name === "document-model") && !EXEMPT.has(name);
}
export function checkStackVersions(manifests, expected) {
  const out = [];
  for (const { name, deps } of manifests) {
    for (const [pkg, version] of Object.entries(deps)) {
      if (!isStackPackage(pkg)) continue;
      if (version !== expected) out.push(`${name}: ${pkg} is ${version}, expected ${expected}`);
    }
  }
  return out;
}
