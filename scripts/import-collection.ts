import path from "node:path";

import { config } from "dotenv";

import { initialLibrary } from "./catalog/initial-library";
import { importCollection, parseCollectionArguments, PROJECT_ROOT } from "./lib/import-collection";
import { formatImportError } from "./lib/import-errors";

async function main() {
  const options = parseCollectionArguments(process.argv.slice(2));

  if (options.help) {
    console.log(`Usage: pnpm import:collection [-- --apply] [--fail-fast]

Default: dry run; parse local EPUBs without database, R2 or cache requests.
--apply      Run the existing import pipeline, including R2 and cache invalidation.
--fail-fast  Stop at the first failed or missing EPUB. Otherwise continue sequentially.
--help, -h   Show this help.

Manifest: scripts/catalog/initial-library.ts
Exit code: 0 if every book succeeded, 1 if any book failed or was missing.
Review/publish and category assignments remain separate editorial steps.`);
    return;
  }

  if (options.apply) {
    config({ path: path.join(PROJECT_ROOT, ".env.local"), quiet: true });
  }

  const result = await importCollection(initialLibrary, options);
  process.exitCode = result.exitCode;
}

main().catch((error: unknown) => {
  console.error(`Collection failed: ${formatImportError(error)}`);
  process.exitCode = 1;
});
