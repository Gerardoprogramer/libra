import { createHash } from "node:crypto";
import fs from "node:fs/promises";

import { createPostgresImportDatabase, type ApplyResult, type ImportDatabase } from "./import-database";
import { formatImportError } from "./import-errors";
import {
  buildImportDiff,
  computePlanDigest,
  evaluateImportPolicy,
  formatImportDiff,
  isValidBookSlug,
  normalizeCreatorName,
  slugify,
  type ImportDiff,
  type ImportFlags,
  type PlanInput,
} from "./import-plan";
import { ImportBlockedError, type StateRequest } from "./import-state";
import { parseEpub } from "./parse-epub";
import { coverKeyFor, uploadCover } from "./r2";
import { revalidateEditorialCache } from "./revalidate-cache";

export interface ImportGutenbergOptions {
  file: string;
  gutenbergId: string;
  slug?: string;
  originalTitle: string;
  originalLanguage: string;
  year?: number;
  editionPublicationYear?: number;
  /** Write to the database. Without it the run is a read-only dry run. */
  apply?: boolean;
  /**
   * Analyze the EPUB alone. The result says nothing about the database: no chapters are reported as kept,
   * unchanged or removed. Never combined with `apply`.
   */
  epubOnly?: boolean;
  /** Token printed by the dry run for the target database; required to apply. */
  confirmDatabase?: string;
  revisePublished?: boolean;
  planHash?: string;
  allowRemovals?: boolean;
  allowSlugChanges?: boolean;
  acceptWarnings?: boolean;
}

export interface ImportDependencies {
  /** Injected in tests; otherwise opened from DIRECT_DATABASE_URL and closed afterwards. */
  database?: ImportDatabase;
  uploadCover?: typeof uploadCover;
  revalidate?: typeof revalidateEditorialCache;
}

export type ImportOutcome =
  | { status: "epub-only" }
  | { status: "blocked"; diff: ImportDiff; planDigest: string; violations: string[] }
  | { status: "planned"; diff: ImportDiff; planDigest: string }
  | { status: "unchanged"; diff: ImportDiff; planDigest: string }
  | { status: "applied"; diff: ImportDiff; planDigest: string; result: ApplyResult };

const GUTENBERG_ID_PATTERN = /^[1-9]\d{0,9}$/;

function openDatabase(): ImportDatabase {
  const url = process.env.DIRECT_DATABASE_URL;

  if (!url) {
    throw new Error(
      "DIRECT_DATABASE_URL is not defined. The comparison with the current database cannot be made, so no plan is reported. Configure it, or pass --epub-only for an analysis of the EPUB alone.",
    );
  }

  return createPostgresImportDatabase(url);
}

export async function importGutenbergBook(
  options: ImportGutenbergOptions,
  dependencies: ImportDependencies = {},
): Promise<ImportOutcome> {
  const {
    file: filePath,
    gutenbergId,
    slug: requestedSlug,
    originalTitle,
    originalLanguage,
    year,
    editionPublicationYear,
    apply: shouldApply = false,
    epubOnly = false,
  } = options;

  if (shouldApply && epubOnly) {
    throw new Error("--epub-only analyzes the EPUB without the database and can never be combined with --apply.");
  }

  if (!GUTENBERG_ID_PATTERN.test(gutenbergId)) {
    throw new Error(`Invalid Gutenberg ID "${gutenbergId}": expected a positive integer.`);
  }

  if (requestedSlug !== undefined && !isValidBookSlug(requestedSlug)) {
    throw new Error(
      `Invalid slug "${requestedSlug}": use lowercase letters, numbers and single hyphens (at most 251 characters).`,
    );
  }

  if (!originalTitle.trim()) {
    throw new Error("The original title must not be empty.");
  }

  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(originalLanguage)) {
    throw new Error(`Invalid original language "${originalLanguage}".`);
  }

  const file = await fs.readFile(filePath);

  const epub = await parseEpub(file);

  const slugWasExplicit = requestedSlug !== undefined;
  const bookSlug = requestedSlug ?? slugify(epub.title);

  if (!isValidBookSlug(bookSlug)) {
    throw new Error(`The slug derived from the EPUB title ("${bookSlug}") is not usable; pass --slug explicitly.`);
  }

  console.log("");
  console.log("EPUB parsed successfully");
  console.log("------------------------");

  console.log(`Title: ${epub.title}`);

  console.log(`Creators: ${epub.creators.join(", ") || "Unknown"}`);

  console.log(`Language: ${epub.language}`);

  console.log(`Translator: ${epub.translator ?? "Not specified"}`);

  console.log(`Book slug: ${bookSlug}${slugWasExplicit ? "" : " (derived from the title)"}`);

  console.log(`Gutenberg ID: ${gutenbergId}`);

  console.log(`Chapters detected: ${epub.chapters.length}`);

  console.log(`Cover: ${epub.cover ? `${epub.cover.mediaType} (${epub.cover.data.length} bytes)` : "Not detected"}`);

  const { extraction } = epub;
  console.log(
    `Text coverage: ${extraction.keptWords} of ${extraction.totalWords} readable words in ${epub.chapters.length} chapter(s)` +
      `${extraction.mergedSubsections ? `, ${extraction.mergedSubsections} numbered subsection(s) merged into their chapters` : ""}; ` +
      `${extraction.closingLines ? `${extraction.closingLines} closing line(s) kept at the end of their chapters; ` : ""}` +
      `${extraction.discardedWords} discarded in ${extraction.discarded.length} section(s), ${extraction.leadingWords} before the first section.`,
  );

  if (extraction.discarded.length) {
    console.log("Discarded sections:");
    for (const item of extraction.discarded.slice(0, 40)) {
      console.log(
        `  ${item.definitive ? "-" : "?"} ${item.reason.padEnd(16)} ${String(item.words).padStart(6)} words  ${item.title.slice(0, 70)}`,
      );
    }
    if (extraction.discarded.length > 40) console.log(`  ... and ${extraction.discarded.length - 40} more`);
  }

  for (const warning of extraction.warnings) console.warn(`WARNING: ${warning}`);

  console.log("");

  for (const chapter of epub.chapters) {
    console.log(`${String(chapter.number).padStart(2, "0")} | ${chapter.title} | ${chapter.wordCount} words`);
  }

  /*
   * EPUB-ONLY ANALYSIS
   *
   * Explicit opt-in. It reports on the file alone and makes no claim about what exists in the database.
   */
  if (!shouldApply && epubOnly) {
    console.log("");
    console.log("EPUB-ONLY ANALYSIS: this EPUB was NOT compared with the database.");
    console.log("It does not show which existing chapters would be changed or removed.");
    console.log("Dry run only. Nothing was written to the database or R2.");

    return { status: "epub-only" };
  }

  const database = dependencies.database ?? openDatabase();
  const ownsDatabase = !dependencies.database;

  try {
    const flags: ImportFlags = {
      allowRemovals: options.allowRemovals ?? false,
      allowSlugChanges: options.allowSlugChanges ?? false,
      revisePublished: options.revisePublished ?? false,
      planHash: options.planHash,
      acceptWarnings: options.acceptWarnings ?? false,
    };

    const input: PlanInput = {
      bookSlug,
      slugWasExplicit,
      gutenbergId,
      epubSha256: createHash("sha256").update(file).digest("hex"),
      editionPublicationYear,
      incoming: {
        title: epub.title,
        language: epub.language,
        translator: epub.translator,
        creators: epub.creators,
        coverKey: epub.cover
          ? coverKeyFor({ bookSlug, gutenbergId, data: epub.cover.data, extension: epub.cover.extension })
          : null,
        chapters: epub.chapters,
      },
    };

    const request: StateRequest = {
      bookSlug,
      gutenbergId,
      creatorSlugs: [
        ...new Set(epub.creators.map((creator) => slugify(normalizeCreatorName(creator))).filter(Boolean)),
      ],
    };

    const { target } = database;
    console.log("");
    console.log(`Target database: ${target.host} (role ${target.role}, id ${target.token})`);

    const evaluate = (state: Parameters<typeof buildImportDiff>[0]) => {
      const diff = buildImportDiff(state, input);
      const planDigest = computePlanDigest(state, input, diff);
      const violations = evaluateImportPolicy({
        diff,
        digest: planDigest,
        extractionWarnings: extraction.warnings,
        slugWasExplicit,
        flags,
      });

      return { diff, planDigest, violations };
    };

    /*
     * DRY RUN
     *
     * Compares the EPUB with a consistent read-only snapshot of the real database. If that snapshot cannot be
     * read the run fails: an unreadable database is never treated as an empty one.
     */
    if (!shouldApply) {
      let state;

      try {
        state = await database.readState(request);
      } catch (error) {
        throw new Error(
          `Could not read the current database state (${formatImportError(error)}). No comparison was made, so no plan is reported.`,
        );
      }

      const { diff, planDigest, violations } = evaluate(state);

      console.log("");
      console.log("Plan against the current database");
      console.log("---------------------------------");
      for (const line of formatImportDiff(diff)) console.log(line);
      console.log(`Plan digest: ${planDigest}`);

      console.log("");
      if (violations.length) {
        console.log("BLOCKED: --apply would be refused for these reasons:");
        for (const violation of violations) console.log(`  - ${violation}`);
      } else if (diff.hasChanges) {
        console.log(
          `--apply would write this plan. Required: --confirm-database ${target.token}${diff.edition.publicationStatus === "PUBLISHED" ? ` --revise-published --plan-hash ${planDigest}` : ""}.`,
        );
      }

      console.log("Dry run only. Nothing was written to the database or R2.");

      return violations.length
        ? { status: "blocked", diff, planDigest, violations }
        : diff.hasChanges
          ? { status: "planned", diff, planDigest }
          : { status: "unchanged", diff, planDigest };
    }

    /*
     * APPLY
     */
    if (options.confirmDatabase !== target.token) {
      throw new Error(
        `Writing requires --confirm-database ${target.token} to confirm the target (${target.host}, role ${target.role}). ${options.confirmDatabase ? "The value given does not match." : "It was not given."}`,
      );
    }

    const upload = dependencies.uploadCover ?? uploadCover;

    const outcome = await database.write(request, async (state, operations): Promise<ImportOutcome> => {
      // Everything is decided again here, from the state read under lock, never from the earlier dry run.
      const { diff, planDigest, violations } = evaluate(state);

      console.log("");
      console.log("Plan under lock");
      console.log("---------------");
      for (const line of formatImportDiff(diff)) console.log(line);
      console.log(`Plan digest: ${planDigest}`);

      if (violations.length) throw new ImportBlockedError(violations);

      if (!diff.hasChanges) return { status: "unchanged", diff, planDigest };

      let coverUrl: string | null = null;
      const coverChanges = !state.edition || diff.metadata.some((change) => change.field === "cover");

      // Upload only after every check has passed.
      if (epub.cover && coverChanges) {
        coverUrl = await upload({
          bookSlug,
          gutenbergId,
          data: epub.cover.data,
          mediaType: epub.cover.mediaType,
          extension: epub.cover.extension,
        });
        console.log("");
        console.log(`Cover uploaded: ${coverUrl}`);
      }

      const result = await operations.apply({
        state,
        diff,
        gutenbergId,
        book: { slug: bookSlug, originalTitle, originalLanguage, originalPublicationYear: year ?? null },
        edition: {
          slug: `${epub.language}-gutenberg-${gutenbergId}`,
          language: epub.language,
          title: epub.title,
          translator: epub.translator,
          publicationYear: editionPublicationYear ?? null,
          sourceUrl: `https://www.gutenberg.org/ebooks/${gutenbergId}`,
          coverUrl,
        },
      });

      console.log("");
      console.log("Database import staged for commit");
      console.log(`Book ID: ${result.bookId}`);
      console.log(`Edition ID: ${result.editionId}`);
      console.log(`Chapters in the edition: ${result.chapters}`);

      return { status: "applied", diff, planDigest, result };
    });

    if (outcome.status === "unchanged") {
      console.log("");
      console.log("Nothing to write: the stored edition already matches the EPUB.");

      return outcome;
    }

    console.log("Database import committed.");

    // The book tag also covers replaced/deleted chapters in every locale.
    await (dependencies.revalidate ?? revalidateEditorialCache)([`book:${bookSlug}`, "library"]);

    return outcome;
  } finally {
    if (ownsDatabase) await database.close();
  }
}
