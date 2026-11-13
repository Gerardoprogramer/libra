import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { createDisposableDatabase, type DisposableDatabase } from "./disposable-postgres";
import { pendingMigrations, readJournal, readLastAppliedMigration } from "./migration-plan";

// db:migrate's preview against a real PostgreSQL: the local disposable container, opt-in like the other integration
// tests (LIBRA_DISPOSABLE_POSTGRES=1; docs/epub-images.md). createDisposableDatabase applies every migration with the
// same migrator db:migrate runs, so a fresh database must show nothing pending.

const enabled = process.env.LIBRA_DISPOSABLE_POSTGRES === "1";
const skip = enabled
  ? false
  : "set LIBRA_DISPOSABLE_POSTGRES=1 with the disposable container running (docs/epub-images.md)";

const journal = readJournal(fileURLToPath(new URL("../../drizzle", import.meta.url)));

let db: DisposableDatabase;

before(async () => {
  if (enabled) db = await createDisposableDatabase();
});
after(async () => {
  if (db) await db.drop();
});

test("db:migrate preview: a database the migrator has brought up to date has nothing pending", { skip }, async () => {
  const last = await readLastAppliedMigration(db.sql);

  assert.equal(last, journal.at(-1)!.when);
  assert.deepEqual(pendingMigrations(journal, last), []);
});

test("db:migrate preview: an unrecorded last migration is the only one pending", { skip }, async () => {
  const newest = journal.at(-1)!;
  await db.sql`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${newest.when}`;

  assert.deepEqual(pendingMigrations(journal, await readLastAppliedMigration(db.sql)), [newest]);
});

test("db:migrate preview: without the migrations table every migration is pending", { skip }, async () => {
  await db.sql`DROP SCHEMA drizzle CASCADE`;

  assert.equal(await readLastAppliedMigration(db.sql), null);
  assert.deepEqual(pendingMigrations(journal, null), journal);
});
