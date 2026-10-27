import { randomUUID } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  authors,
  bookAuthors,
  books,
  chapters,
  editionAssets,
  editions,
  imageAssets,
  readingProgress,
} from "../../src/db/schema";
import { ChapterText, readStoredChapterBlocks } from "../../src/lib/chapter-blocks";
import { postgresTls } from "../../src/db/tls";

import { describeDatabaseTarget, type DatabaseTarget, type ImportDiff, type PlannedImage } from "./import-plan";
import { remapReadingPosition } from "./reimport-chapters";
import type { EditionState, StateRequest } from "./import-state";

export interface ApplyArgs {
  state: EditionState;
  diff: ImportDiff;
  gutenbergId: string;
  book: {
    slug: string;
    originalTitle: string;
    originalLanguage: string;
    originalPublicationYear: number | null;
  };
  edition: {
    slug: string;
    language: string;
    title: string;
    translator: string | null;
    publicationYear: number | null;
    sourceUrl: string;
    /** Public URL of the cover uploaded for this plan, or null when the plan does not change the cover. */
    coverUrl: string | null;
  };
  /** Every image the edition uses after the write: one per source path, as the plan describes them. */
  images: PlannedImage[];
  /** Object keys verified in the store by this import, before the transaction; every image must be one of them. */
  verifiedKeys: ReadonlySet<string>;
}

export interface ApplyResult {
  bookId: string;
  editionId: string;
  chapters: number;
}

/** The database already holds an asset of the same identity whose bytes differ: the codec is not reproducible. */
export class ImageAssetConflictError extends Error {
  constructor(sourcePath: string, detail: string) {
    super(
      `Image ${sourcePath}: image_assets already holds this identity with different bytes (${detail}). The codec did not reproduce them; nothing was written.`,
    );
    this.name = "ImageAssetConflictError";
  }
}

/** The edition's chapters and associations, as they stand before commit, do not agree: the write is rolled back. */
export class EditionConsistencyError extends Error {
  constructor(problems: string[]) {
    super(
      `The edition would be inconsistent; nothing was written:\n${problems.map((item) => `  - ${item}`).join("\n")}`,
    );
    this.name = "EditionConsistencyError";
  }
}

/** The writes of one import. Every call happens inside the transaction opened by `ImportDatabase.write`. */
export interface WriteOperations {
  apply(args: ApplyArgs): Promise<ApplyResult>;
}

export interface ImportDatabase {
  target: DatabaseTarget;
  /** Consistent, strictly read-only snapshot. Throws if the database cannot be read. */
  readState(request: StateRequest): Promise<EditionState>;
  /**
   * Opens a write transaction, takes the per-source advisory lock and locks the rows involved, then runs
   * `run` with the state read under that lock. Any throw rolls everything back.
   */
  write<T>(request: StateRequest, run: (state: EditionState, operations: WriteOperations) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export type Transaction = Parameters<Parameters<ReturnType<typeof drizzle>["transaction"]>[0]>[0];

export async function loadState(tx: Transaction, request: StateRequest, locked: boolean): Promise<EditionState> {
  const [book] = await tx
    .select({ id: books.id, slug: books.slug })
    .from(books)
    .where(eq(books.slug, request.bookSlug))
    .limit(1);

  const editionSelection = tx
    .select({
      id: editions.id,
      bookId: editions.bookId,
      slug: editions.slug,
      language: editions.language,
      title: editions.title,
      translator: editions.translator,
      publicationYear: editions.publicationYear,
      coverUrl: editions.coverUrl,
      sourceUrl: editions.sourceUrl,
      copyrightStatus: editions.copyrightStatus,
      publicationStatus: editions.publicationStatus,
    })
    .from(editions)
    .where(and(eq(editions.sourceName, "Project Gutenberg"), eq(editions.sourceIdentifier, request.gutenbergId)))
    .limit(1);
  const [edition] = locked ? await editionSelection.for("update") : await editionSelection;

  const bookAuthorRows = book
    ? await tx
        .select({ id: authors.id, slug: authors.slug, name: authors.name })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(eq(bookAuthors.bookId, book.id))
    : [];

  const creatorAuthors = request.creatorSlugs.length
    ? await tx
        .select({ id: authors.id, slug: authors.slug, name: authors.name })
        .from(authors)
        .where(inArray(authors.slug, request.creatorSlugs))
    : [];

  const chapterSelection = edition ? tx.select().from(chapters).where(eq(chapters.editionId, edition.id)) : null;
  const chapterRows = chapterSelection ? await (locked ? chapterSelection.for("update") : chapterSelection) : [];

  // Only this edition's associations; their assets are read, never locked: other editions may share them.
  const assetRows = edition
    ? await tx
        .select({
          sourcePath: editionAssets.sourcePath,
          assetId: imageAssets.id,
          sourceSha256: imageAssets.sourceSha256,
          codecId: imageAssets.codecId,
          maxWidth: imageAssets.maxWidth,
          sha256: imageAssets.sha256,
          objectKey: imageAssets.objectKey,
          mediaType: imageAssets.mediaType,
          width: imageAssets.width,
          height: imageAssets.height,
          byteSize: imageAssets.byteSize,
        })
        .from(editionAssets)
        .innerJoin(imageAssets, eq(imageAssets.id, editionAssets.assetId))
        .where(eq(editionAssets.editionId, edition.id))
        .orderBy(editionAssets.sourcePath)
    : [];

  // No user identifiers are read: only which chapters hold a saved position and where.
  let progressRows: EditionState["progressRows"] = [];
  let progressChapterIds: string[] = [];
  if (edition && locked) {
    progressRows = await tx
      .select({
        id: readingProgress.id,
        chapterId: readingProgress.chapterId,
        paragraphIndex: readingProgress.paragraphIndex,
        percentage: readingProgress.percentage,
      })
      .from(readingProgress)
      .where(eq(readingProgress.editionId, edition.id))
      .for("update");
    progressChapterIds = [...new Set(progressRows.map((row) => row.chapterId))];
  } else if (edition) {
    const rows = await tx
      .selectDistinct({ chapterId: readingProgress.chapterId })
      .from(readingProgress)
      .where(eq(readingProgress.editionId, edition.id));
    progressChapterIds = rows.map((row) => row.chapterId);
  }

  return {
    book: book ?? null,
    bookAuthors: bookAuthorRows,
    creatorAuthors,
    edition: edition ?? null,
    chapters: chapterRows.map((chapter) => ({
      id: chapter.id,
      number: chapter.number,
      slug: chapter.slug,
      title: chapter.title,
      content: chapter.content,
      wordCount: chapter.wordCount,
      blocks: chapter.blocks,
    })),
    // Sorted again in code: ORDER BY follows the database collation, the plan compares code points.
    assets: assetRows.sort((first, second) =>
      first.sourcePath < second.sourcePath ? -1 : first.sourcePath > second.sourcePath ? 1 : 0,
    ),
    progressChapterIds,
    progressRows,
  };
}

/**
 * The image_assets row of this image's identity: inserted, or, when it exists (an earlier import, or a concurrent one
 * that won the race on the unique identity), the existing row, which must describe exactly the same bytes.
 */
async function resolveAsset(tx: Transaction, image: PlannedImage): Promise<string> {
  const [inserted] = await tx
    .insert(imageAssets)
    .values({
      sourceSha256: image.sourceSha256,
      codecId: image.codecId,
      maxWidth: image.maxWidth,
      sha256: image.sha256,
      objectKey: image.key,
      mediaType: image.mediaType,
      width: image.width,
      height: image.height,
      byteSize: image.bytes,
    })
    .onConflictDoNothing({ target: [imageAssets.sourceSha256, imageAssets.codecId, imageAssets.maxWidth] })
    .returning({ id: imageAssets.id });
  if (inserted) return inserted.id;

  const [existing] = await tx
    .select()
    .from(imageAssets)
    .where(
      and(
        eq(imageAssets.sourceSha256, image.sourceSha256),
        eq(imageAssets.codecId, image.codecId),
        eq(imageAssets.maxWidth, image.maxWidth),
      ),
    )
    .limit(1);
  if (!existing) throw new Error(`Image ${image.sourcePath}: its asset was neither inserted nor found`);
  const differences = (
    [
      ["sha256", existing.sha256, image.sha256],
      ["object key", existing.objectKey, image.key],
      ["media type", existing.mediaType, image.mediaType],
      ["width", existing.width, image.width],
      ["height", existing.height, image.height],
      ["byte size", existing.byteSize, image.bytes],
    ] as const
  ).filter(([, stored, expected]) => stored !== expected);
  if (differences.length) {
    throw new ImageAssetConflictError(
      image.sourcePath,
      differences.map(([field, stored, expected]) => `${field} ${stored}, expected ${expected}`).join("; "),
    );
  }
  return existing.id;
}

/**
 * The checks run before commit, on what the transaction now holds for the edition: every stored blocks value is valid
 * and derives its chapter's text, every figure image has this edition's association to an asset of the planned bytes
 * and media type, and no association is left that no figure uses. Any problem rolls the whole write back.
 */
export async function assertEditionConsistent(
  tx: Transaction,
  editionId: string,
  planned: ReadonlyMap<string, PlannedImage>,
) {
  const rows = await tx
    .select({ slug: chapters.slug, content: chapters.content, blocks: chapters.blocks })
    .from(chapters)
    .where(eq(chapters.editionId, editionId));
  const associations = await tx
    .select({
      sourcePath: editionAssets.sourcePath,
      sourceSha256: imageAssets.sourceSha256,
      sha256: imageAssets.sha256,
      objectKey: imageAssets.objectKey,
      mediaType: imageAssets.mediaType,
    })
    .from(editionAssets)
    .innerJoin(imageAssets, eq(imageAssets.id, editionAssets.assetId))
    .where(eq(editionAssets.editionId, editionId));
  const byPath = new Map(associations.map((row) => [row.sourcePath, row]));

  const problems: string[] = [];
  const referenced = new Set<string>();
  for (const row of rows) {
    const stored = readStoredChapterBlocks(row.blocks, row.content);
    if (stored.status === "invalid") problems.push(`chapter ${row.slug}: ${stored.reason}`);
    if (stored.status !== "blocks") continue;
    for (const block of stored.blocks.blocks) {
      if (block.type !== "figure" || !block.image) continue;
      const { path, mediaType } = block.image;
      referenced.add(path);
      const association = byPath.get(path);
      const image = planned.get(path);
      if (!association) problems.push(`chapter ${row.slug}: figure image ${path} has no association`);
      else if (association.mediaType !== mediaType)
        problems.push(`${path}: asset type ${association.mediaType}, figure ${mediaType}`);
      else if (
        !image ||
        association.sourceSha256 !== image.sourceSha256 ||
        association.sha256 !== image.sha256 ||
        association.objectKey !== image.key
      ) {
        problems.push(`${path}: associated with an asset that is not the planned image`);
      }
    }
  }
  for (const path of byPath.keys()) {
    if (!referenced.has(path)) problems.push(`association ${path} is used by no figure`);
  }
  if (problems.length) throw new EditionConsistencyError(problems);
}

export function createOperations(tx: Transaction): WriteOperations {
  return {
    async apply({ state, diff, gutenbergId, book: bookInput, edition: editionInput, images, verifiedKeys }) {
      // Before any write: every image was verified in the store by this import, and they are the plan's images.
      const planned = new Map(images.map((image) => [image.sourcePath, image]));
      const unverified = images.filter((image) => !verifiedKeys.has(image.key));
      if (unverified.length) {
        throw new Error(
          `Images not verified in the object store by this import (${unverified.map((image) => image.sourcePath).join(", ")}); nothing was written. Run the import again.`,
        );
      }
      if (
        planned.size !== images.length ||
        diff.images.filter((change) => change.incoming).length !== planned.size ||
        diff.images.some((change) => change.incoming && planned.get(change.sourcePath) !== change.incoming)
      ) {
        throw new Error("The plan's images are not the images given to write; nothing was written.");
      }

      /*
       * BOOK
       */
      let book = state.book;

      if (!book) {
        const [createdBook] = await tx
          .insert(books)
          .values({
            slug: bookInput.slug,
            originalTitle: bookInput.originalTitle,
            originalLanguage: bookInput.originalLanguage,
            originalPublicationYear: bookInput.originalPublicationYear,
          })
          .returning({ id: books.id, slug: books.slug });

        if (!createdBook) {
          throw new Error("Could not create book");
        }

        book = createdBook;
      }

      /*
       * AUTHORS
       *
       * Planned only when the book has none yet. An existing author is reused as stored: the import never
       * renames it, so a hand-corrected name survives and homonyms are never silently rewritten.
       */
      for (const [index, author] of diff.authors.entries()) {
        let authorId: string | undefined =
          author.action === "reuse" ? state.creatorAuthors.find((item) => item.slug === author.slug)?.id : undefined;

        if (!authorId) {
          const [created] = await tx
            .insert(authors)
            .values({ slug: author.slug, name: author.name })
            .onConflictDoNothing({ target: authors.slug })
            .returning({ id: authors.id });
          authorId = created?.id;
        }

        if (!authorId) {
          // Created concurrently since the plan was made: reuse it, never overwrite it.
          const [existing] = await tx
            .select({ id: authors.id })
            .from(authors)
            .where(eq(authors.slug, author.slug))
            .limit(1);
          authorId = existing?.id;
        }

        if (!authorId) {
          throw new Error(`Could not create or find author: ${author.name}`);
        }

        await tx.insert(bookAuthors).values({ bookId: book.id, authorId, position: index }).onConflictDoNothing();
      }

      /*
       * EDITION
       *
       * Copyright and publication state are never modified here: a new edition enters as DRAFT /
       * PENDING_REVIEW and an existing one keeps whatever the editorial review decided.
       */
      let editionId: string;

      if (!state.edition) {
        const [created] = await tx
          .insert(editions)
          .values({
            bookId: book.id,
            slug: editionInput.slug,
            language: editionInput.language,
            title: editionInput.title,
            translator: editionInput.translator,
            publicationYear: editionInput.publicationYear,
            coverUrl: editionInput.coverUrl,
            sourceName: "Project Gutenberg",
            sourceIdentifier: gutenbergId,
            sourceUrl: editionInput.sourceUrl,
            copyrightStatus: "PENDING_REVIEW",
            publicationStatus: "DRAFT",
            copyrightNotes: "Imported for manual copyright and edition review before publication.",
          })
          .returning({ id: editions.id });

        if (!created) {
          throw new Error("Could not create edition");
        }

        editionId = created.id;
      } else {
        editionId = state.edition.id;

        if (diff.metadata.length) {
          const changed = new Set(diff.metadata.map((change) => change.field));

          await tx
            .update(editions)
            .set({
              ...(changed.has("title") ? { title: editionInput.title } : {}),
              ...(changed.has("language") ? { language: editionInput.language } : {}),
              ...(changed.has("slug") ? { slug: editionInput.slug } : {}),
              ...(changed.has("translator") ? { translator: editionInput.translator } : {}),
              ...(changed.has("sourceUrl") ? { sourceUrl: editionInput.sourceUrl } : {}),
              ...(changed.has("publicationYear") ? { publicationYear: editionInput.publicationYear } : {}),
              ...(changed.has("cover") && editionInput.coverUrl ? { coverUrl: editionInput.coverUrl } : {}),
              updatedAt: new Date(),
            })
            .where(eq(editions.id, editionId));
        }
      }

      /*
       * CHAPTERS
       *
       * Matched chapters keep their UUID (and so any saved reading progress). Unchanged chapters are not
       * touched at all.
       */
      // The text columns of every chapter written: blocks validated against the exact content stored with them.
      const textOf = (change: (typeof diff.chapters)[number]) =>
        ChapterText.withBlocks(change.incoming.content, change.incoming.blocks);

      // Vacate unique slugs/numbers without deleting UUIDs or their FK targets.
      const temporaryPrefix = randomUUID();
      const relocated = diff.chapters.filter(
        (change) => change.existing && (change.changes.includes("slug") || change.changes.includes("number")),
      );
      for (const [index, change] of relocated.entries()) {
        await tx
          .update(chapters)
          .set({ slug: `__import_${temporaryPrefix}_${index}`, number: -(index + 1) })
          .where(eq(chapters.id, change.existing!.id));
      }

      if (diff.removed.length) {
        await tx.delete(chapters).where(
          inArray(
            chapters.id,
            diff.removed.map((chapter) => chapter.id),
          ),
        );
      }

      for (const change of diff.chapters) {
        if (change.kind === "new") {
          const { number, slug, title } = change.incoming;
          await tx.insert(chapters).values({ editionId, number, slug, title, ...textOf(change).columns() });
        } else if (change.kind === "modified" && change.existing) {
          const { number, slug, title } = change.incoming;
          await tx
            .update(chapters)
            .set({ number, slug, title, ...textOf(change).columns(), updatedAt: new Date() })
            .where(eq(chapters.id, change.existing.id));

          if (change.changes.includes("content")) {
            for (const saved of state.progressRows.filter((row) => row.chapterId === change.existing!.id)) {
              // Only the position inside the same chapter: chapter_id and updated_at stay as the reader left them.
              await tx
                .update(readingProgress)
                .set(remapReadingPosition(change.existing.content, change.incoming.content, saved))
                .where(eq(readingProgress.id, saved.id));
            }
          }
        }
      }

      /*
       * IMAGES
       *
       * Only images verified in the object store by this import, before this transaction, are referenced. Assets
       * are shared by identity across editions: inserted when new, otherwise the existing row, which must describe
       * the same bytes. Associations change only for this edition, from the plan computed under the lock.
       */
      const changing = diff.images.filter((change) => change.kind !== "unchanged");
      const assetIds = new Map<string, string>();
      for (const change of changing) {
        const image = change.incoming;
        if (!image) continue;
        const identity = `${image.sourceSha256}/${image.codecId}/${image.maxWidth}`;
        if (assetIds.has(identity)) continue;
        assetIds.set(identity, await resolveAsset(tx, image));
      }

      const dissociated = changing.filter((change) => change.kind === "removed" || change.kind === "changed");
      if (dissociated.length) {
        await tx.delete(editionAssets).where(
          and(
            eq(editionAssets.editionId, editionId),
            inArray(
              editionAssets.sourcePath,
              dissociated.map((change) => change.sourcePath),
            ),
          ),
        );
      }
      for (const change of changing) {
        const image = change.incoming;
        if (!image) continue;
        const assetId = assetIds.get(`${image.sourceSha256}/${image.codecId}/${image.maxWidth}`)!;
        await tx.insert(editionAssets).values({ editionId, assetId, sourcePath: image.sourcePath });
      }

      await assertEditionConsistent(tx, editionId, planned);

      return { bookId: book.id, editionId, chapters: diff.chapters.length };
    },
  };
}

/**
 * The write transaction's isolation, set explicitly instead of relying on the server default: under READ COMMITTED,
 * when the INSERT ... ON CONFLICT DO NOTHING of resolveAsset finds a row a concurrent import committed, the SELECT
 * that follows sees it. Under REPEATABLE READ the snapshot would hide it and the write would fail.
 */
export const WRITE_TRANSACTION: PgTransactionConfig = { isolationLevel: "read committed" };

/** The import database over a postgres.js drizzle instance; `close` ends its connection. */
export function createImportDatabase(
  db: ReturnType<typeof drizzle>,
  target: DatabaseTarget,
  close: () => Promise<void>,
): ImportDatabase {
  return {
    target,

    readState: (request) =>
      db.transaction((tx) => loadState(tx, request, false), {
        isolationLevel: "repeatable read",
        accessMode: "read only",
      }),

    write: (request, run) =>
      db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`Project Gutenberg:${request.gutenbergId}`}, 0))`,
        );

        // The plan is computed from the state read under this lock, not from the earlier dry run.
        const state = await loadState(tx, request, true);

        return run(state, createOperations(tx));
      }, WRITE_TRANSACTION),

    close,
  };
}

/** Real implementation over postgres.js. One connection; call `close()` when done. */
export function createPostgresImportDatabase(connectionString: string): ImportDatabase {
  const target = describeDatabaseTarget(connectionString);
  const client = postgres(connectionString, {
    max: 1,
    prepare: false,
    ssl: postgresTls(connectionString, { local: false }),
  });

  return createImportDatabase(drizzle(client), target, () => client.end());
}
