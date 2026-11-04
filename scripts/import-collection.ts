import path from "node:path";

import { config } from "dotenv";

import { initialLibrary } from "./catalog/initial-library";
import { importCollection, parseCollectionArguments, PROJECT_ROOT } from "./lib/import-collection";
import { formatImportError } from "./lib/import-errors";

async function main() {
  const options = parseCollectionArguments(process.argv.slice(2));

  if (options.help) {
    console.log(`Usage: pnpm import:collection [-- --apply --confirm-database <id>] [options]

Default: dry run. Every EPUB is parsed and compared with the CURRENT database (read-only): new, changed and
removed chapters, URL changes and metadata are listed per book. If the database cannot be read the book FAILS;
the run never reports an empty comparison.

--epub-only            Analyze the EPUBs alone, WITHOUT the database. Changes and removals are not reported.
--apply                Write. Requires --confirm-database with the id printed by the dry run.
--confirm-database <id>  Target id printed by the dry run ("Target database: ... id <id>").
--allow-removals       Allow chapters that disappear from an EPUB to be deleted (draft editions only here).
--allow-slug-changes   Allow chapter URL changes (draft editions only here).
--accept-warnings      Accept EPUB extraction warnings after reading them.
--fail-fast            Stop at the first failed, blocked or missing EPUB. Otherwise continue sequentially.
--help, -h             Show this help.

A PUBLISHED edition is never modified from a collection run. A book whose published edition would change is
reported as BLOCKED; revise it with pnpm import:gutenberg --revise-published --plan-hash <digest>.
A cover made for Libra (covers/libra/) is always kept; replace it with pnpm import:gutenberg --replace-custom-cover.

Manifest: scripts/catalog/initial-library.ts
Exit code: 0 if every book succeeded, 1 if any book failed, was blocked or was missing.
Review/publish and category assignments remain separate editorial steps.`);
    return;
  }

  // Only the explicit EPUB-only analysis runs without the database configuration.
  if (!options.epubOnly) {
    config({ path: path.join(PROJECT_ROOT, ".env.local"), quiet: true });
  }

  const result = await importCollection(initialLibrary, options);
  process.exitCode = result.exitCode;
}

main().catch((error: unknown) => {
  console.error(`Collection failed: ${formatImportError(error)}`);
  process.exitCode = 1;
});
