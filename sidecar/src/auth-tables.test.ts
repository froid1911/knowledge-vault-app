import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { NodeFS } from "@electric-sql/pglite/nodefs";
import { describe, expect, it } from "vitest";
import { ensureKyselyMigrationTables } from "./auth-tables.js";

describe("ensureKyselyMigrationTables", () => {
  it("creates the auth migrator's public tables when another schema already holds same-named ones, once", async () => {
    const data = join(mkdtempSync(join(tmpdir(), "kv-auth-")), "read-model");
    const db = new PGlite({ fs: new NodeFS(data) });
    // What a store first opened without authentication looks like: the attachments service's
    // migrator has its tables in its own schema; nothing in public.
    await db.exec(`create schema attachments;
      create table attachments.kysely_migration ("name" varchar(255) primary key, "timestamp" varchar(255) not null);
      create table attachments.kysely_migration_lock ("id" varchar(255) primary key, "is_locked" integer not null default 0);`);
    await db.close();
    expect(await ensureKyselyMigrationTables(data)).toEqual({ created: true });
    const check = new PGlite({ fs: new NodeFS(data) });
    expect((await check.query(`select schemaname from pg_tables where tablename = 'kysely_migration_lock' order by 1`)).rows).toEqual([{ schemaname: "attachments" }, { schemaname: "public" }]);
    expect((await check.query(`select id, is_locked from public.kysely_migration_lock`)).rows).toEqual([{ id: "migration_lock", is_locked: 0 }]);
    expect((await check.query(`select count(*)::int as n from public.kysely_migration`)).rows).toEqual([{ n: 0 }]);
    await check.close();
    expect(await ensureKyselyMigrationTables(data)).toEqual({ created: false });
  }, 60_000);
  it("leaves a store that has no database alone", async () => {
    const data = join(mkdtempSync(join(tmpdir(), "kv-auth-")), "read-model");
    expect(await ensureKyselyMigrationTables(data)).toEqual({ created: false, skipped: "no database" });
    expect(existsSync(data)).toBe(false);
  });
});
