export async function resolve(specifier, context, next) {
  if (specifier === "@powerhousedao/pglite-fs") return { url: new URL("./nodefs-shim.mjs", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
