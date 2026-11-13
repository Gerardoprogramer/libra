import { parseArgs } from "node:util";

import { isValidBookSlug } from "./import-plan";
import { assertConfirmationNeedsApply } from "./write-guard";
import type { ImportGutenbergOptions } from "./import-gutenberg";

const INT32 = { min: -2147483648, max: 2147483647 };

function parseYear(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;

  const year = Number(value);

  if (!/^-?\d+$/.test(value) || !Number.isInteger(year) || year < INT32.min || year > INT32.max) {
    throw new Error(`${name} must be a PostgreSQL-supported integer.`);
  }

  return year;
}

export const gutenbergHelp = `Usage: pnpm import:gutenberg -- --file <epub> --gutenberg-id <n> --original-title <title> --original-language <code> [options]

Default: dry run. It compares the EPUB with the CURRENT database and prints the plan (new, changed and
removed chapters, URL changes, metadata). If the database cannot be read the run fails; it never reports an
empty comparison.

  --slug <slug>              Book slug. Without it the slug is derived from the EPUB title and may not
                             attach the edition to an existing book.
  --year <n>                 First publication year of the original work.
  --edition-year <n>         Publication year of this edition.
  --epub-only                Analyze the EPUB alone, WITHOUT comparing it with the database.

Writing (all of these are required together, after reading a dry run):
  --apply                    Write the plan.
  --confirm-database <id>    Target id printed by the dry run ("Target database: ... id <id>").

Gates, each needed only when the plan calls for it:
  --allow-removals           Allow chapters that disappear from the EPUB to be deleted.
  --allow-slug-changes       Allow published chapter URLs to change.
  --accept-warnings          Accept the EPUB extraction warnings after reviewing them.
  --revise-published         Modify a PUBLISHED edition. Requires --plan-hash.
  --plan-hash <digest>       Digest printed by the dry run; the write is refused if the EPUB or the
                             database changed since.
  --replace-custom-cover     Replace a cover made for Libra (covers/libra/) with the EPUB's. Without it,
                             such a cover is always kept.

Chapters with saved reading progress are never deleted by the importer.`;

export function parseGutenbergArguments(args: readonly string[]): {
  help: boolean;
  options?: ImportGutenbergOptions;
} {
  const { values } = parseArgs({
    args: args[0] === "--" ? args.slice(1) : [...args],
    options: {
      file: { type: "string" },
      "gutenberg-id": { type: "string" },
      slug: { type: "string" },
      "original-title": { type: "string" },
      "original-language": { type: "string" },
      year: { type: "string" },
      "edition-year": { type: "string" },
      apply: { type: "boolean", default: false },
      "epub-only": { type: "boolean", default: false },
      "confirm-database": { type: "string" },
      "revise-published": { type: "boolean", default: false },
      "plan-hash": { type: "string" },
      "allow-removals": { type: "boolean", default: false },
      "allow-slug-changes": { type: "boolean", default: false },
      "accept-warnings": { type: "boolean", default: false },
      "replace-custom-cover": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) return { help: true };

  const required = (name: "file" | "gutenberg-id" | "original-title" | "original-language") => {
    const value = values[name];

    if (!value?.trim()) throw new Error(`Missing --${name} argument`);

    return value;
  };

  const gutenbergId = required("gutenberg-id");

  if (!/^[1-9]\d{0,9}$/.test(gutenbergId)) {
    throw new Error(`--gutenberg-id must be a positive integer, got "${gutenbergId}".`);
  }

  const originalLanguage = required("original-language");

  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(originalLanguage)) {
    throw new Error(`--original-language must be a language code such as "en", got "${originalLanguage}".`);
  }

  if (values.slug !== undefined && !isValidBookSlug(values.slug)) {
    throw new Error("--slug must use lowercase letters, numbers and single hyphens (at most 251 characters).");
  }

  if (values.apply && values["epub-only"]) {
    throw new Error("--epub-only analyzes the EPUB without the database and cannot be combined with --apply.");
  }

  assertConfirmationNeedsApply(values.apply, values["confirm-database"]);

  if (values["plan-hash"] !== undefined && !/^[0-9a-f]{20}$/.test(values["plan-hash"])) {
    throw new Error("--plan-hash must be the 20-character digest printed by the dry run.");
  }

  if (values["plan-hash"] !== undefined && !values["revise-published"]) {
    throw new Error("--plan-hash only applies together with --revise-published.");
  }

  return {
    help: false,
    options: {
      file: required("file"),
      gutenbergId,
      slug: values.slug,
      originalTitle: required("original-title"),
      originalLanguage,
      year: parseYear("--year", values.year),
      editionPublicationYear: parseYear("--edition-year", values["edition-year"]),
      apply: values.apply,
      epubOnly: values["epub-only"],
      confirmDatabase: values["confirm-database"],
      revisePublished: values["revise-published"],
      planHash: values["plan-hash"],
      allowRemovals: values["allow-removals"],
      allowSlugChanges: values["allow-slug-changes"],
      acceptWarnings: values["accept-warnings"],
      replaceCustomCover: values["replace-custom-cover"],
    },
  };
}
