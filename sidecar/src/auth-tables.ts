import { existsSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { NodeFS } from "@electric-sql/pglite/nodefs";

/**
 * Before a protected start on a store that was first opened without
 * authentication (spec §4.4 — the switch), the read-model database needs the
 * authorization migrator's own bookkeeping tables in `public`.
 *
 * Why: reactor-api's auth migrations run only with AUTH_ENABLED, through a
 * Kysely Migrator with the default table names and no schema. Kysely decides
 * whether those tables exist by name alone, across every schema, and the
 * attachments service already keeps `kysely_migration` / `kysely_migration_lock`
 * in its own schema. So on such a store the migrator skips creating its tables
 * and then selects from `public.kysely_migration_lock`, which does not exist:
 * "Migration failed: relation kysely_migration_lock does not exist". A fresh
 * store is fine (auth migrates first). Creating the two tables with Kysely's
 * own DDL (and the lock row it expects) lets the migrator proceed; an upstream
 * fix is for the migrator to name its schema (spec §8).
 */
export async function ensureKyselyMigrationTables(readModelDir: string): Promise<{ created: boolean; skipped?: "no database" }> {
  if (!existsSync(join(readModelDir, "PG_VERSION"))) return { created: false, skipped: "no database" };
  const db = new PGlite({ fs: new NodeFS(readModelDir) });
  try {
    const present = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_tables where schemaname = 'public' and tablename in ('kysely_migration', 'kysely_migration_lock')`,
    );
    if (present.rows[0]?.n === 2) return { created: false };
    await db.exec(`
      create table if not exists public.kysely_migration ("name" varchar(255) not null primary key, "timestamp" varchar(255) not null);
      create table if not exists public.kysely_migration_lock ("id" varchar(255) not null primary key, "is_locked" integer default 0 not null);
      insert into public.kysely_migration_lock ("id", "is_locked") values ('migration_lock', 0) on conflict do nothing;
    `);
    return { created: true };
  } finally {
    await db.close();
  }
}
