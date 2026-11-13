// pnpm db:migrate wraps the migrator that drizzle-kit migrate runs (drizzle-orm/postgres-js/migrator, folder drizzle/,
// table drizzle.__drizzle_migrations) with the guard of the other scripts that write:
//
//   pnpm db:migrate                                         dry run: masked target and pending migrations (READ ONLY)
//   pnpm db:migrate -- --apply [--confirm-database <id>]    applies them; a remote database also needs its id
//
// drizzle-kit has no dry run, so the preview applies the migrator's own rule to drizzle/meta/_journal.json and the
// last recorded migration (scripts/lib/migration-plan.ts). The migrator applies every pending migration in one
// transaction. Use a development database first: README, "Development database".

import { fileURLToPath } from "node:url";

import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { formatImportError } from "./lib/import-errors";
import { describeDatabaseTarget } from "./lib/import-plan";
import {
  describePendingMigrations,
  MIGRATIONS_SCHEMA,
  MIGRATIONS_TABLE,
  pendingMigrations,
  readJournal,
  readLastAppliedMigration,
} from "./lib/migration-plan";
import { assertWriteAllowed, dryRunNotice, formatDatabaseTarget, parseApplyArguments, sslFor } from "./lib/write-guard";

config({
  path: ".env.local",
});

if (!process.env.DIRECT_DATABASE_URL) {
  throw new Error("DIRECT_DATABASE_URL is not defined");
}

const connectionString: string = process.env.DIRECT_DATABASE_URL;
const args = process.argv.slice(2);
const { apply } = parseApplyArguments(args, "db:migrate");
const target = describeDatabaseTarget(connectionString);

// Fails before any connection is opened if the target is remote and not explicitly confirmed.
if (apply) {
  assertWriteAllowed({ connectionString, args, script: "db:migrate", allowRemote: true });
}

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

const client = postgres(connectionString, {
  max: 1,
  prepare: false,
  ssl: sslFor(connectionString),
  onnotice: () => {},
});

async function main() {
  console.log(formatDatabaseTarget(target));

  const journal = readJournal(migrationsFolder);
  const pending = pendingMigrations(journal, await readLastAppliedMigration(client));

  for (const line of describePendingMigrations(pending)) console.log(line);

  if (!apply) {
    if (pending.length > 0) for (const line of dryRunNotice(target)) console.log(line);
    return;
  }

  if (pending.length === 0) return;

  await migrate(drizzle(client), {
    migrationsFolder,
    migrationsSchema: MIGRATIONS_SCHEMA,
    migrationsTable: MIGRATIONS_TABLE,
  });

  const remaining = pendingMigrations(journal, await readLastAppliedMigration(client));
  if (remaining.length > 0)
    throw new Error(`The migrator finished with ${remaining.length} migration(s) still pending.`);

  console.log(`Applied ${pending.length} migration(s).`);
}

main()
  .catch((error) => {
    console.error("");
    console.error("Migration failed");
    console.error(formatImportError(error));

    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
