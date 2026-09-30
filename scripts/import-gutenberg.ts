import { config } from "dotenv";

import { formatImportError } from "./lib/import-errors";
import { importGutenbergBook } from "./lib/import-gutenberg";

function getArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

function getRequiredArgument(name: string): string {
  const value = getArgument(name);

  if (!value) {
    throw new Error(`Missing ${name} argument`);
  }

  return value;
}

async function main() {
  config({ path: ".env.local", quiet: true });

  const publicationYearArgument = getArgument("--year");
  const year = publicationYearArgument ? Number(publicationYearArgument) : undefined;

  if (year !== undefined && Number.isNaN(year)) {
    throw new Error("--year must be a number");
  }

  await importGutenbergBook({
    file: getRequiredArgument("--file"),
    gutenbergId: getRequiredArgument("--gutenberg-id"),
    slug: getArgument("--slug"),
    year,
    apply: process.argv.includes("--apply"),
  });
}

main().catch((error: unknown) => {
  console.error("");
  console.error("Import failed");
  console.error(formatImportError(error));
  process.exitCode = 1;
});
