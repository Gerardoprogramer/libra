import { readFileSync } from "node:fs";
import path from "node:path";

import type postgres from "postgres";

/** An entry of drizzle/meta/_journal.json: `when` is the migration's folderMillis, `tag` its file name. */
export interface JournalEntry {
  tag: string;
  when: number;
}

/** Drizzle's defaults, which drizzle.config.ts does not override: drizzle.__drizzle_migrations. */
export const MIGRATIONS_SCHEMA = "drizzle";
export const MIGRATIONS_TABLE = "__drizzle_migrations";

/** Reads and validates the journal that drizzle-kit generate writes and the migrator reads. */
export function readJournal(migrationsFolder: string): JournalEntry[] {
  const journal: unknown = JSON.parse(readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8"));
  const entries = (journal as { entries?: unknown }).entries;

  if (!Array.isArray(entries)) throw new Error("drizzle/meta/_journal.json has no entries list.");

  return entries.map((entry, index) => {
    const { tag, when } = (entry ?? {}) as { tag?: unknown; when?: unknown };
    if (typeof tag !== "string" || !tag || typeof when !== "number" || !Number.isSafeInteger(when)) {
      throw new Error(`drizzle/meta/_journal.json entry ${index} has no valid tag and when.`);
    }
    return { tag, when };
  });
}

/**
 * The migrations the migrator would apply, with its own rule (drizzle-orm pg-core dialect, `migrate`): every journal
 * entry newer than the created_at of the last recorded migration, or all of them when nothing is recorded yet.
 */
export function pendingMigrations(entries: readonly JournalEntry[], lastAppliedAt: number | null): JournalEntry[] {
  return entries.filter((entry) => lastAppliedAt === null || lastAppliedAt < entry.when);
}

/**
 * created_at of the last recorded migration, read in a READ ONLY transaction; null when the migrations table does not
 * exist yet (a database that never ran a migration).
 */
export async function readLastAppliedMigration(sql: postgres.Sql): Promise<number | null> {
  return sql.begin("read only", async (tx) => {
    const [{ exists }] = await tx<{ exists: boolean }[]>`
      SELECT to_regclass(${`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`}) IS NOT NULL AS exists`;
    if (!exists) return null;

    const [row] = await tx<{ createdAt: string | null }[]>`
      SELECT max(created_at)::text AS "createdAt" FROM ${tx(MIGRATIONS_SCHEMA)}.${tx(MIGRATIONS_TABLE)}`;
    return row?.createdAt == null ? null : Number(row.createdAt);
  });
}

/** The lines a dry run prints: each pending migration in order, or that there is nothing to apply. */
export function describePendingMigrations(pending: readonly JournalEntry[]): string[] {
  if (pending.length === 0) return ["No pending migrations: the database already has every migration in drizzle/."];

  return [`Pending migrations (${pending.length}), in order:`, ...pending.map((entry) => `  ${entry.tag}`)];
}
