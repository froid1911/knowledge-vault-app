/**
 * The conversion helper is the user's own docling service (`../docling/src`),
 * vendored into `sidecar/converter/` so the app ships exactly what that repo
 * runs. Vendored: the entry, its modules and their typings — not tests,
 * fixtures or configs. `--check` keeps the copy honest.
 */
export function selectConverterFiles(names) {
  return names
    .filter(
      (n) =>
        !n.includes("/") &&
        !/\.test\.[cm]?[jt]sx?$/.test(n) &&
        (n === "server.ts" || n.endsWith(".mjs") || n.endsWith(".d.mts")),
    )
    .sort();
}

/** Differences between the source set and the vendored set, as `missing:`, `stale:` and `extra:` lines. */
export function diffVendored(source, vendored) {
  const out = [];
  for (const [name, content] of source) {
    if (!vendored.has(name)) out.push(`missing: ${name}`);
    else if (vendored.get(name) !== content) out.push(`stale: ${name}`);
  }
  for (const name of vendored.keys()) if (!source.has(name)) out.push(`extra: ${name}`);
  return out;
}
