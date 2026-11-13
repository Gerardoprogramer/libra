// Rewrites editions.cover_url from one public R2 base to another (see docs/r2-custom-domain.md). A dry run by default:
// it reads inside a READ ONLY transaction and prints what --apply would change. --apply writes only to a target
// confirmed with --confirm-database, locks the rows, re-plans under the lock, updates each row only if it still holds
// the URL that was planned, and then invalidates the editorial cache. Running it again changes nothing; running it with
// --from and --to swapped undoes it. It never touches R2 objects.
import { config } from "dotenv";
import postgres from "postgres";

import {
  parseCoverOriginArguments,
  parseMediaBase,
  planCoverOriginMigration,
  type CoverRow,
} from "./lib/cover-origin-migration";
import { describeDatabaseTarget } from "./lib/import-plan";
import { revalidateEditorialCache } from "./lib/revalidate-cache";
import { assertWriteAllowed, sslFor } from "./lib/write-guard";

const usage = `Usage: pnpm db:migrate-cover-origin --from <old base> --to <new base> [--apply --confirm-database <id>]

  --from <url>               Current public base of the covers, e.g. https://pub-<id>.r2.dev
  --to <url>                 New public base, e.g. https://covers.example.com
  --apply                    Write the plan. Without it, nothing is written.
  --confirm-database <id>    Target id printed by the dry run; required with --apply on a remote database.`;

config({ path: ".env.local", quiet: true });

const values = parseCoverOriginArguments(process.argv.slice(2));

if (values.help) {
  console.log(usage);
  process.exit(0);
}

const from = parseMediaBase(values.from, "--from");
const to = parseMediaBase(values.to, "--to");
if (!process.env.DIRECT_DATABASE_URL) throw new Error("DIRECT_DATABASE_URL is not defined");
const connectionString: string = process.env.DIRECT_DATABASE_URL;

const target = describeDatabaseTarget(connectionString);
console.log(`Target database: ${target.host} (role ${target.role}, id ${target.token})`);
console.log(`Mode: ${values.apply ? "APPLY" : "DRY RUN (nothing is written)"}`);
console.log(`From: ${from.href}/\nTo:   ${to.href}/`);

const sql = postgres(connectionString, { max: 1, prepare: false, ssl: sslFor(connectionString) });

function report(plan: ReturnType<typeof planCoverOriginMigration>, total: number) {
  console.log(`Editions read: ${total}`);
  console.log(`To change: ${plan.changes.length}`);
  console.log(`Already under the new base: ${plan.alreadyMigrated}`);
  console.log(`Without cover: ${plan.withoutCover}`);
  console.log(`Under neither base (left alone): ${plan.elsewhere.length}`);
  for (const change of plan.changes.slice(0, 5)) {
    console.log(`  ${change.id}: ${change.from} -> ${change.to}`);
  }
  if (plan.changes.length > 5) console.log(`  … and ${plan.changes.length - 5} more`);
}

async function main() {
  if (!values.apply) {
    const rows = await sql.begin("read only", (tx) => tx<CoverRow[]>`select id, cover_url as "coverUrl" from editions`);
    report(planCoverOriginMigration(rows, from, to), rows.length);
    console.log(`\nDry run only. To write: add --apply${target.isLocal ? "" : ` --confirm-database ${target.token}`}.`);
  } else {
    assertWriteAllowed({
      connectionString,
      args: process.argv.slice(2),
      script: "db:migrate-cover-origin",
      allowRemote: true,
    });

    const changed = await sql.begin(async (tx) => {
      const rows = await tx<CoverRow[]>`select id, cover_url as "coverUrl" from editions for update`;
      const plan = planCoverOriginMigration(rows, from, to);
      report(plan, rows.length);

      let updated = 0;
      for (const change of plan.changes) {
        const result =
          await tx`update editions set cover_url = ${change.to} where id = ${change.id} and cover_url = ${change.from}`;
        updated += result.count;
      }
      // Rows are locked, so every planned row must have been updated; anything else rolls back the whole run.
      if (updated !== plan.changes.length) {
        throw new Error(`Updated ${updated} of ${plan.changes.length} planned rows; rolled back, nothing was written.`);
      }
      return updated;
    });

    console.log(`\nUpdated ${changed} edition(s).`);
    if (changed > 0) {
      const invalidated = await revalidateEditorialCache(["library"]);
      console.log(
        invalidated ? "Editorial cache invalidated." : "WARNING: editorial cache not invalidated; see above.",
      );
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
