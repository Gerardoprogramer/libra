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
import type { ImageCodec } from "./epub-images";
import { ImportBlockedError, type StateRequest } from "./import-state";
import { storeImages, type ObjectStore } from "./object-store";
import { parseEpub, type ImageWarning } from "./parse-epub";
import { coverKeyFor, uploadCover } from "./r2";
import { revalidateEditorialCache } from "./revalidate-cache";
import { createVerifiedSharpCodec } from "./sharp-codec";

/** One line per unusable image, naming the edition, the chapter, the image and why. */
export function formatImageWarning(gutenbergId: string, warning: ImageWarning) {
  return `Image unavailable in Gutenberg ${gutenbergId}, chapter ${warning.chapter} ("${warning.chapterTitle}"): ${warning.sourcePath ?? warning.reference} — ${warning.code}: ${warning.reason}. The figure keeps its alt text and caption, without an image.`;
}

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
  /**
   * The codec that normalizes the EPUB's images. By default the sharp codec verified against the approved
   * environments, before the EPUB is parsed: an unsupported environment stops the import before any image is
   * processed. Tests inject one.
   */
  createCodec?: () => Promise<ImageCodec>;
  /**
   * Where normalized images are stored and verified. There is no default: until a store with a verified bucket and
   * environment exists, an import that would write images is refused before anything is written.
   */
  objectStore?: ObjectStore;
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

  // The codec is verified before the EPUB is parsed: an unsupported environment processes no image at all.
  const codec = await (dependencies.createCodec ?? createVerifiedSharpCodec)();

  const epub = await parseEpub(file, {}, { codec });
  const images = epub.images;
  if (!images) throw new Error("The EPUB was parsed without normalizing its images.");

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

  console.log(
    `Images: ${images.length} normalized for the figures (codec ${codec.id}); ${epub.imageWarnings.length} figure(s) without a usable image.`,
  );

  // The extractor's warnings and every unusable image: each needs a human decision (--accept-warnings).
  const warnings = [
    ...extraction.warnings,
    ...epub.imageWarnings.map((warning) => formatImageWarning(gutenbergId, warning)),
  ];
  for (const warning of warnings) console.warn(`WARNING: ${warning}`);

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
        images: images.map((image) => ({
          sourcePath: image.sourcePath,
          sourceSha256: image.sourceSha256,
          codecId: image.codec,
          maxWidth: image.maxWidth,
          sha256: image.sha256,
          key: image.key,
          mediaType: image.mediaType,
          width: image.width,
          height: image.height,
          bytes: image.bytes,
        })),
      },
      warnings,
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
      const planDigest = computePlanDigest(state, input, diff, flags);
      const violations = evaluateImportPolicy({
        diff,
        digest: planDigest,
        extractionWarnings: warnings,
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
        // With warnings, this point is only reached when --accept-warnings was given, and the digest includes it.
        console.log(
          `--apply would write this plan. Required: --confirm-database ${target.token}${warnings.length ? " --accept-warnings" : ""}${diff.edition.publicationStatus === "PUBLISHED" ? ` --revise-published --plan-hash ${planDigest}` : ""}.`,
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

    /*
     * IMAGES, OUTSIDE ANY TRANSACTION
     *
     * A read-only check first, so a plan the policy refuses stores nothing. Then every image is stored and verified
     * (read back and hashed) before the transaction opens; the transaction itself makes no network call for them.
     * An object stored for a write that then fails is left unreferenced, never referenced unverified; the next run
     * verifies and reuses it.
     */
    let verifiedKeys: ReadonlySet<string> = new Set();
    {
      let preview;
      try {
        preview = evaluate(await database.readState(request));
      } catch (error) {
        throw new Error(
          `Could not read the current database state (${formatImportError(error)}). Nothing was stored or written.`,
        );
      }
      if (preview.violations.length) throw new ImportBlockedError(preview.violations);

      if (preview.diff.hasChanges && images.length) {
        const store = dependencies.objectStore;
        if (!store) {
          throw new Error(
            `This plan writes ${images.length} image(s), but image storage is not enabled: no object store with a verified bucket and environment is configured. Nothing was stored or written.`,
          );
        }
        console.log("");
        console.log(`Storing and verifying ${images.length} image(s) in ${store.description}...`);
        const stored = await storeImages(store, images);
        const uploaded = [...stored.values()].filter((outcome) => outcome === "uploaded").length;
        console.log(
          `Images verified: ${stored.size} object(s), ${uploaded} uploaded, ${stored.size - uploaded} reused.`,
        );
        verifiedKeys = new Set(stored.keys());
      }
    }

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

      // The database changed since the check above, and the plan now needs images that were not stored and verified.
      const unprepared = images.filter((image) => !verifiedKeys.has(image.key));
      if (unprepared.length) {
        throw new Error(
          `The plan under lock needs ${unprepared.length} image(s) that were not stored and verified before the transaction; nothing was written. Run the import again.`,
        );
      }

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
        images: input.incoming.images,
        verifiedKeys,
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
