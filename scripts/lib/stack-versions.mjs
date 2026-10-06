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

/**
 * PGlite is not a stack package, but the sidecar's pin must equal the Switchboard's own: two
 * versions would mean two WASM runtimes in one process and a storage format the engine did not choose.
 */
export function checkPgliteVersion(sidecarPin, switchboardPin) {
  if (!switchboardPin) return "switchboard: no @electric-sql/pglite dependency found — cannot verify the sidecar's pin";
  if (sidecarPin !== switchboardPin) return `sidecar: @electric-sql/pglite is ${sidecarPin}, the Switchboard pins ${switchboardPin}`;
  return null;
}
