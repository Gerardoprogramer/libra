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

function getOptionalYear(name: string): number | undefined {
  const argument = getArgument(name);

  if (argument === undefined) {
    return undefined;
  }

  const year = Number(argument);

  if (!Number.isInteger(year) || year < -2147483648 || year > 2147483647) {
    throw new Error(`${name} must be a PostgreSQL-supported integer.`);
  }

  return year;
}

async function main() {
  config({ path: ".env.local", quiet: true });

  await importGutenbergBook({
    file: getRequiredArgument("--file"),
    gutenbergId: getRequiredArgument("--gutenberg-id"),
    slug: getArgument("--slug"),
    year: getOptionalYear("--year"),
    editionPublicationYear: getOptionalYear("--edition-year"),
    apply: process.argv.includes("--apply"),
  });
}

main().catch((error: unknown) => {
  console.error("");
  console.error("Import failed");
  console.error(formatImportError(error));
  process.exitCode = 1;
});
