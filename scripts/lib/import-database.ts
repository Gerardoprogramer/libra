import { randomUUID } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { authors, bookAuthors, books, chapters, editions, readingProgress } from "../../src/db/schema";
import { postgresTls } from "../../src/db/tls";

import { describeDatabaseTarget, type DatabaseTarget, type ImportDiff } from "./import-plan";
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
}

export interface ApplyResult {
  bookId: string;
  editionId: string;
  chapters: number;
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
    })),
    progressChapterIds,
    progressRows,
  };
}

export function createOperations(tx: Transaction): WriteOperations {
  return {
    async apply({ state, diff, gutenbergId, book: bookInput, edition: editionInput }) {
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
      const values = (change: (typeof diff.chapters)[number]) => ({
        number: change.incoming.number,
        slug: change.incoming.slug,
        title: change.incoming.title,
        content: change.incoming.content,
        wordCount: change.incoming.wordCount,
      });

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
          await tx.insert(chapters).values({ ...values(change), editionId });
        } else if (change.kind === "modified" && change.existing) {
          await tx
            .update(chapters)
            .set({ ...values(change), updatedAt: new Date() })
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

      return { bookId: book.id, editionId, chapters: diff.chapters.length };
    },
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
  const db = drizzle(client);

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
      }),

    close: () => client.end(),
  };
}
