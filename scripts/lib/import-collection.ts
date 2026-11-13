import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { formatImportError } from "./import-errors";
import { importGutenbergBook, type ImportGutenbergOptions, type ImportOutcome } from "./import-gutenberg";
import { assertConfirmationNeedsApply } from "./write-guard";

export const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export interface CatalogEntry {
  file: string;
  gutenbergId: number;
  slug: string;

  /** Original work title. */
  originalTitle: string;

  /** Original work language. */
  originalLanguage: string;

  /** Original work's first publication year. */
  year?: number;

  /** Publication year of this particular edition, when known. */
  editionPublicationYear?: number;
}

export function parseCollectionManifest(value: unknown): CatalogEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("The collection manifest must be a non-empty array.");
  }

  const identifiers = new Set<number>();
  const files = new Set<string>();

  return Array.from(value, (entry: unknown, index) => {
    const label = `Manifest entry #${index + 1}`;

    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`${label}: expected a book object.`);
    }

    if (
      Object.keys(entry).some(
        (key) =>
          ![
            "file",
            "gutenbergId",
            "slug",
            "originalTitle",
            "originalLanguage",
            "year",
            "editionPublicationYear",
          ].includes(key),
      )
    ) {
      throw new Error(
        `${label}: only file, gutenbergId, slug, year and editionPublicationYear are supported. Categories use seed-categories.ts.`,
      );
    }

    if (
      !("originalTitle" in entry) ||
      typeof entry.originalTitle !== "string" ||
      entry.originalTitle.trim().length === 0 ||
      entry.originalTitle.length > 500
    ) {
      throw new Error(`${label}: originalTitle must be a non-empty string.`);
    }

    if (
      !("originalLanguage" in entry) ||
      typeof entry.originalLanguage !== "string" ||
      !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(entry.originalLanguage)
    ) {
      throw new Error(`${label}: originalLanguage must be a valid language code.`);
    }

    if (!("file" in entry) || typeof entry.file !== "string") {
      throw new Error(`${label}: file must reference a local EPUB in imports/.`);
    }

    const file = entry.file.replace(/\\/g, "/");

    if (
      !file.startsWith("imports/") ||
      file.split("/").includes("..") ||
      /[\x00-\x1f:*?"<>|]/.test(file) ||
      path.posix.extname(file).toLowerCase() !== ".epub"
    ) {
      throw new Error(`${label}: file must be an .epub path inside imports/, relative to the project root.`);
    }

    if (
      !("gutenbergId" in entry) ||
      typeof entry.gutenbergId !== "number" ||
      !Number.isSafeInteger(entry.gutenbergId) ||
      entry.gutenbergId <= 0
    ) {
      throw new Error(`${label}: gutenbergId must be a positive safe integer.`);
    }

    if (
      !("slug" in entry) ||
      typeof entry.slug !== "string" ||
      entry.slug.length > 251 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug)
    ) {
      throw new Error(
        `${label}: slug must use lowercase letters, numbers and single hyphens (at most 251 characters).`,
      );
    }

    if (
      "year" in entry &&
      (typeof entry.year !== "number" ||
        !Number.isInteger(entry.year) ||
        entry.year < -2147483648 ||
        entry.year > 2147483647)
    ) {
      throw new Error(`${label}: year must be an integer supported by PostgreSQL, or omitted.`);
    }

    if (
      "editionPublicationYear" in entry &&
      (typeof entry.editionPublicationYear !== "number" ||
        !Number.isInteger(entry.editionPublicationYear) ||
        entry.editionPublicationYear < -2147483648 ||
        entry.editionPublicationYear > 2147483647)
    ) {
      throw new Error(`${label}: editionPublicationYear must be an integer supported by PostgreSQL, or omitted.`);
    }

    const normalizedFile = path.posix.normalize(file);
    // Avoid accidentally importing the same local file twice, including on Windows.
    const fileKey = normalizedFile.toLowerCase();

    if (identifiers.has(entry.gutenbergId) || files.has(fileKey)) {
      throw new Error(`${label}: duplicate gutenbergId or EPUB file.`);
    }

    identifiers.add(entry.gutenbergId);
    files.add(fileKey);

    return {
      file: normalizedFile,
      gutenbergId: entry.gutenbergId,
      slug: entry.slug,
      originalTitle: entry.originalTitle.trim(),
      originalLanguage: entry.originalLanguage,
      ...("year" in entry ? { year: entry.year as number } : {}),
      ...("editionPublicationYear" in entry ? { editionPublicationYear: entry.editionPublicationYear as number } : {}),
    };
  });
}

export function parseCollectionArguments(args: string[]) {
  const { values } = parseArgs({
    args: args[0] === "--" ? args.slice(1) : args,
    options: {
      apply: { type: "boolean", default: false },
      "fail-fast": { type: "boolean", default: false },
      "epub-only": { type: "boolean", default: false },
      "confirm-database": { type: "string" },
      "allow-removals": { type: "boolean", default: false },
      "allow-slug-changes": { type: "boolean", default: false },
      "accept-warnings": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.apply && values["epub-only"]) {
    throw new Error("--epub-only analyzes the EPUBs without the database and cannot be combined with --apply.");
  }

  assertConfirmationNeedsApply(values.apply, values["confirm-database"]);

  return {
    apply: values.apply,
    failFast: values["fail-fast"],
    epubOnly: values["epub-only"],
    confirmDatabase: values["confirm-database"],
    allowRemovals: values["allow-removals"],
    allowSlugChanges: values["allow-slug-changes"],
    acceptWarnings: values["accept-warnings"],
    help: values.help,
  };
}

interface CollectionOptions {
  apply?: boolean;
  failFast?: boolean;
  projectRoot?: string;
  /** Analyze the EPUBs alone, without comparing them with the database. */
  epubOnly?: boolean;
  confirmDatabase?: string;
  allowRemovals?: boolean;
  allowSlugChanges?: boolean;
  acceptWarnings?: boolean;
}

interface CollectionDependencies {
  importBook?: (options: ImportGutenbergOptions) => Promise<ImportOutcome | void>;
  logger?: Pick<Console, "log" | "error">;
}

export async function importCollection(
  manifest: unknown,
  {
    apply = false,
    failFast = false,
    projectRoot = PROJECT_ROOT,
    epubOnly = false,
    confirmDatabase,
    allowRemovals,
    allowSlugChanges,
    acceptWarnings,
  }: CollectionOptions = {},
  { importBook = importGutenbergBook, logger = console }: CollectionDependencies = {},
) {
  // Validate the entire manifest before starting any import.
  const entries = parseCollectionManifest(manifest);
  let succeeded = 0;
  let missing = 0;
  let failed = 0;
  let blocked = 0;
  const mode = apply ? "APPLY" : epubOnly ? "EPUB-ONLY DRY RUN" : "DRY RUN";

  logger.log(`Collection: ${entries.length} book(s). Mode: ${mode}.`);
  if (epubOnly) {
    logger.log("EPUB-only analysis: nothing is compared with the database, so removals and changes are NOT reported.");
  }
  logger.log(`Sequential imports. On error: ${failFast ? "stop immediately" : "continue; final exit code 1"}.`);

  for (const [index, entry] of entries.entries()) {
    const label = `[${index + 1}/${entries.length}] ${entry.slug} (Gutenberg ${entry.gutenbergId})`;
    const file = path.resolve(projectRoot, entry.file);
    logger.log(`\n${label} — ${entry.file}`);

    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) {
        throw new Error("The EPUB path is not a regular file.");
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        missing++;
        logger.error(`${label} MISSING: place the EPUB at ${entry.file}. Nothing imported for this entry.`);
      } else {
        failed++;
        logger.error(`${label} FAILED: ${formatImportError(error)}`);
      }

      if (failFast) break;
      continue;
    }

    try {
      // Await the entire pipeline, including invalidation and connection cleanup.
      // A published edition is never revised from a collection run (no --revise-published here): each one
      // needs its own reviewed plan through pnpm import:gutenberg. Likewise a cover made for Libra is always kept
      // here (no --replace-custom-cover): replacing one is a per-book decision.
      const outcome = await importBook({
        file,
        gutenbergId: String(entry.gutenbergId),
        slug: entry.slug,
        originalTitle: entry.originalTitle,
        originalLanguage: entry.originalLanguage,
        year: entry.year,
        editionPublicationYear: entry.editionPublicationYear,
        apply,
        epubOnly,
        confirmDatabase,
        allowRemovals,
        allowSlugChanges,
        acceptWarnings,
        replaceCustomCover: false,
      });

      if (outcome?.status === "blocked") {
        blocked++;
        logger.error(`${label} BLOCKED: ${outcome.violations.join(" | ")}`);
      } else {
        succeeded++;
        const description =
          outcome?.status === "epub-only"
            ? "EPUB analyzed; NOT compared with the database"
            : outcome?.status === "unchanged"
              ? "already matches the database; nothing to write"
              : outcome?.status === "planned"
                ? "plan checked against the database; no writes"
                : apply
                  ? "import committed"
                  : "EPUB checked; no writes";
        logger.log(`${label} OK: ${description}.`);
      }
    } catch (error) {
      failed++;
      logger.error(`${label} FAILED: ${formatImportError(error)}`);
      if (failFast) break;
    }
  }

  const notProcessed = entries.length - succeeded - missing - failed - blocked;
  logger.log(
    `\nSummary (${mode}): ${succeeded} succeeded, ${missing} missing, ${failed} failed, ${blocked} blocked, ${notProcessed} not processed.`,
  );

  return {
    succeeded,
    missing,
    failed,
    blocked,
    notProcessed,
    exitCode: missing > 0 || failed > 0 || blocked > 0 ? 1 : 0,
  };
}
