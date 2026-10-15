import { config } from "dotenv";

import { gutenbergHelp, parseGutenbergArguments } from "./lib/import-arguments";
import { formatImportError } from "./lib/import-errors";
import { importGutenbergBook } from "./lib/import-gutenberg";

async function main() {
  const { help, options } = parseGutenbergArguments(process.argv.slice(2));

  if (help || !options) {
    console.log(gutenbergHelp);
    return;
  }

  // The dry run needs the database to compare against; only the explicit EPUB-only analysis can do without.
  if (!options.epubOnly) config({ path: ".env.local", quiet: true });

  const outcome = await importGutenbergBook(options);

  if (outcome.status === "blocked") process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("");
  console.error("Import failed");
  console.error(formatImportError(error));
  process.exitCode = 1;
});
