// THROWAWAY: copy the two PGlite snapshot stores into the spike Postgres.
// Schema via pg_dump --schema-only; data via COPY TO '/dev/blob' (CSV) and
// psql \copy; relaxedDurability so PGlite never rewrites the 1 GB snapshot.
import { PGlite } from "@electric-sql/pglite";
import { pgDump } from "@electric-sql/pglite-tools/pg_dump";
import { AtomicNodeFs } from "@powerhousedao/pglite-fs";
import { writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import pg from "pg";

const SP = "/home/beast/Documents/Powerhouse/vault-standalone-spike";
const stores = [
  { name: "reactor", dir: `${SP}/store-a/reactor-storage`, db: "reactor" },
  { name: "readmodel", dir: `${SP}/store-a/read-storage`, db: "readmodel" },
];
const PGC = { host: "127.0.0.1", port: 5499, user: "spike", password: "spike" };
const only = process.argv[2];
const q = (s) => `"${s.replace(/"/g, '""')}"`;
const fmtS = (t0) => ((performance.now() - t0) / 1000).toFixed(1) + "s";
const psql = (db, args) => spawnSync("psql", ["-v", "ON_ERROR_STOP=0", "-q", "-h", PGC.host, "-p", String(PGC.port), "-U", PGC.user, "-d", db, ...args],
  { env: { ...process.env, PGPASSWORD: PGC.password }, encoding: "utf8", maxBuffer: 1 << 26 });

for (const s of stores) {
  if (only && only !== s.name) continue;
  const T = performance.now();
  const lite = new PGlite({ fs: new AtomicNodeFs(s.dir, { flushIntervalMs: 24 * 3600 * 1000 }), relaxedDurability: true });
  await lite.waitReady;
  console.log(`[${s.name}] opened in ${fmtS(T)}`);
  const schemaFile = await pgDump({ pg: lite, args: ["--schema-only", "--no-owner", "--no-privileges"] });
  const schemaSql = Buffer.from(await schemaFile.arrayBuffer());
  await writeFile(`${SP}/store-a/${s.name}.schema.sql`, schemaSql);
  psql(s.db, ["-c", "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"]);
  for (const sch of (await lite.query(`select nspname from pg_namespace where nspname not in ('pg_catalog','information_schema','pg_toast','public')`)).rows) psql(s.db, ["-c", `DROP SCHEMA IF EXISTS ${q(sch.nspname)} CASCADE`]);
  const r = psql(s.db, ["-f", `${SP}/store-a/${s.name}.schema.sql`]);
  const errs = (r.stderr ?? "").split("\n").filter((l) => /ERROR/.test(l));
  console.log(`[${s.name}] schema ${(schemaSql.length / 1024).toFixed(0)} KB restored; ${errs.length} ERROR lines${errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""}`);

  const client = new pg.Client({ ...PGC, database: s.db }); await client.connect();
  const tables = (await lite.query(`select table_schema as s, table_name as t from information_schema.tables where table_type='BASE TABLE' and table_schema not in ('pg_catalog','information_schema') order by 1,2`)).rows;
  let total = 0, mismatches = 0;
  for (const { s: sch, t } of tables) {
    const t0 = performance.now();
    const n = Number((await lite.query(`select count(*)::int as n from ${q(sch)}.${q(t)}`)).rows[0].n);
    const file = `${SP}/store-a/csv/${s.name}.${sch}.${t}.csv`;
    let mb = 0;
    if (n > 0) {
      const res = await lite.query(`COPY ${q(sch)}.${q(t)} TO '/dev/blob' WITH (FORMAT csv)`);
      const buf = Buffer.from(await res.blob.arrayBuffer()); mb = buf.length / 1048576;
      await writeFile(file, buf);
      const c = psql(s.db, ["-c", `\\copy ${q(sch)}.${q(t)} FROM '${file}' WITH (FORMAT csv)`]);
      const e = (c.stderr ?? "").split("\n").filter((l) => /ERROR/.test(l));
      if (e.length) console.log(`  !! ${sch}.${t}: ${e[0].slice(0, 200)}`);
    }
    const cols = (await lite.query(`select column_name as c, column_default as def, is_identity as ident from information_schema.columns where table_schema=$1 and table_name=$2`, [sch, t])).rows;
    for (const c of cols) if ((c.def ?? "").startsWith("nextval(") || c.ident === "YES")
      await client.query(`SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT MAX(${q(c.c)}) FROM ${q(sch)}.${q(t)}), 0) + 1, false)`, [`${q(sch)}.${q(t)}`, c.c]);
    const got = Number((await client.query(`select count(*)::int as n from ${q(sch)}.${q(t)}`)).rows[0].n);
    if (got !== n) mismatches++;
    total += got;
    console.log(`[${s.name}] ${sch}.${t}: ${got}/${n} rows, ${mb.toFixed(1)} MB csv, ${fmtS(t0)}${got !== n ? "  <-- MISMATCH" : ""}`);
  }
  await client.end();
  console.log(`[${s.name}] DONE ${tables.length} tables, ${total} rows, ${mismatches} mismatches, ${fmtS(T)}`);
}
process.exit(0); // no lite.close(): avoid rewriting the snapshot copy
