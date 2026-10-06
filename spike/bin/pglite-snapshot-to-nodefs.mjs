// THROWAWAY: turn the AtomicNodeFs single-file snapshots into plain PGlite
// NodeFS data directories (on-disk, no snapshot), for variant D.
import { PGlite } from "@electric-sql/pglite";
import { AtomicNodeFs } from "@powerhousedao/pglite-fs";
import { rm } from "node:fs/promises";
const SP = "/home/beast/Documents/Powerhouse/vault-standalone-spike";
for (const [name, src, dst] of [["reactor", `${SP}/store-a/reactor-storage`, `${SP}/store-d/reactor-storage`], ["readmodel", `${SP}/store-a/read-storage`, `${SP}/store-d/read-storage`]]) {
  const t0 = performance.now();
  const lite = new PGlite({ fs: new AtomicNodeFs(src, { flushIntervalMs: 24 * 3600 * 1000 }), relaxedDurability: true });
  await lite.waitReady;
  const tar = await lite.dumpDataDir("none");
  console.log(`[${name}] dumped data dir: ${(tar.size / 1048576).toFixed(0)} MB in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  await rm(dst, { recursive: true, force: true });
  const t1 = performance.now();
  const disk = new PGlite({ dataDir: dst, loadDataDir: tar });
  await disk.waitReady;
  const n = await disk.query(`select count(*)::int as n from information_schema.tables where table_schema not in ('pg_catalog','information_schema')`);
  await disk.close();
  console.log(`[${name}] NodeFS data dir written to ${dst} (${n.rows[0].n} tables) in ${((performance.now() - t1) / 1000).toFixed(1)}s`);
}
process.exit(0);
