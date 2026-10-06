// THROWAWAY: bundle the runner with optional adapters stubbed, then compile.
const STUB = `${import.meta.dir}/stubs/empty.cjs`;
const optional = /^(better-sqlite3|fastify|@fastify\/.+|mercurius|@mercuriusjs\/gateway|mysql2?|oracledb|pg-query-stream|tedious|sqlite3|prettier-plugin-.+|@prettier\/plugin-.+|@shopify\/prettier-plugin-liquid|@zackad\/prettier-plugin-twig)$/;
const r = await Bun.build({
  entrypoints: [`${import.meta.dir}/run-switchboard.mjs`],
  outdir: `${import.meta.dir}/out`, target: "bun", format: "esm", sourcemap: "none", minify: false,
  plugins: [{ name: "stub-optional", setup(b) { b.onResolve({ filter: optional }, () => ({ path: STUB })); } }],
});
if (!r.success) { for (const l of r.logs.slice(0, 15)) console.error(String(l).slice(0, 300)); process.exit(1); }
for (const o of r.outputs) console.log("out:", o.path.replace(import.meta.dir + "/", ""), (o.size / 1048576).toFixed(1), "MB");
