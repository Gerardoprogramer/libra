import fs from "node:fs/promises";

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { authors, bookAuthors, books, chapters, editions } from "../../src/db/schema";

import { parseEpub } from "./parse-epub";
import { uploadCover } from "./r2";
import { revalidateEditorialCache } from "./revalidate-cache";

export interface ImportGutenbergOptions {
  file: string;
  gutenbergId: string;
  slug?: string;
  year?: number;
  editionPublicationYear?: number;
  apply?: boolean;
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeCreatorName(value: string) {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 2) {
    return `${parts[1]} ${parts[0]}`;
  }

  return value.trim();
}

export async function importGutenbergBook({
  file: filePath,
  gutenbergId,
  slug: requestedSlug,
  year,
  editionPublicationYear,
  apply: shouldApply = false,
}: ImportGutenbergOptions): Promise<void> {
  const publicationYear = editionPublicationYear ?? null;

  const file = await fs.readFile(filePath);

  const epub = await parseEpub(file);

  const bookSlug = requestedSlug ?? slugify(epub.title);

  console.log("");
  console.log("EPUB parsed successfully");
  console.log("------------------------");

  console.log(`Title: ${epub.title}`);

  console.log(`Creators: ${epub.creators.join(", ") || "Unknown"}`);

  console.log(`Language: ${epub.language}`);

  console.log(`Translator: ${epub.translator ?? "Not specified"}`);

  console.log(`Book slug: ${bookSlug}`);

  console.log(`Gutenberg ID: ${gutenbergId}`);

  console.log(`Chapters detected: ${epub.chapters.length}`);

  console.log(`Cover: ${epub.cover ? `${epub.cover.mediaType} (${epub.cover.data.length} bytes)` : "Not detected"}`);

  console.log("");

  for (const chapter of epub.chapters) {
    console.log(`${String(chapter.number).padStart(2, "0")} | ${chapter.title} | ${chapter.wordCount} words`);
  }

  /*
   * DRY RUN
   *
   * Nothing is uploaded to R2 or written
   * to PostgreSQL unless --apply is used.
   */
  if (!shouldApply) {
    console.log("");

    console.log("Dry run only. Nothing was written to the database or R2.");

    console.log("Run again with --apply if the chapter list looks correct.");

    return;
  }

  // Dry runs never create a database client or require credentials.
  if (!process.env.DIRECT_DATABASE_URL) {
    throw new Error("DIRECT_DATABASE_URL is not defined");
  }

  const client = postgres(process.env.DIRECT_DATABASE_URL, {
    max: 1,
    prepare: false,
    ssl: "require",
  });
  const db = drizzle(client);

  try {
    /*
     * COVER
     *
     * Upload before writing the edition so
     * PostgreSQL receives the final public URL.
     */
    let coverUrl: string | null = null;

    if (epub.cover) {
      coverUrl = await uploadCover({
        bookSlug,
        gutenbergId,
        data: epub.cover.data,
        mediaType: epub.cover.mediaType,
        extension: epub.cover.extension,
      });

      console.log("");

      console.log(`Cover uploaded: ${coverUrl}`);
    } else {
      console.log("");

      console.log("No cover found in EPUB.");
    }

    /*
     * DATABASE
     */
    await db.transaction(async (tx) => {
      /*
       * BOOK
       */
      const [existingBook] = await tx.select().from(books).where(eq(books.slug, bookSlug)).limit(1);

      let book = existingBook;

      if (!book) {
        const [createdBook] = await tx
          .insert(books)
          .values({
            slug: bookSlug,

            originalTitle: epub.title,

            originalLanguage: epub.language,

            originalPublicationYear: year ?? null,
          })
          .returning();

        if (!createdBook) {
          throw new Error("Could not create book");
        }

        book = createdBook;
      }

      /*
       * AUTHORS
       *
       * Only create author relations when
       * the book doesn't have any yet.
       */
      const existingAuthors = await tx
        .select({
          id: authors.id,
        })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(eq(bookAuthors.bookId, book.id));

      if (existingAuthors.length === 0) {
        for (const [index, rawCreator] of epub.creators.entries()) {
          const creator = normalizeCreatorName(rawCreator);

          const authorSlug = slugify(creator);

          const [author] = await tx
            .insert(authors)
            .values({
              slug: authorSlug,
              name: creator,
            })
            .onConflictDoUpdate({
              target: authors.slug,

              set: {
                name: creator,
                updatedAt: new Date(),
              },
            })
            .returning();

          if (!author) {
            throw new Error(`Could not create author: ${creator}`);
          }

          await tx
            .insert(bookAuthors)
            .values({
              bookId: book.id,
              authorId: author.id,
              position: index,
            })
            .onConflictDoNothing();
        }
      }

      /*
       * DELETE DEVELOPMENT SEED
       *
       * If Frankenstein/another book was
       * previously created by our seed,
       * remove that fake edition.
       *
       * Chapters disappear automatically
       * because of ON DELETE CASCADE.
       */
      const developmentEditions = await tx
        .select({
          id: editions.id,
        })
        .from(editions)
        .where(and(eq(editions.bookId, book.id), eq(editions.sourceName, "Development seed")));

      for (const developmentEdition of developmentEditions) {
        await tx.delete(editions).where(eq(editions.id, developmentEdition.id));
      }

      /*
       * EDITION
       */
      const editionSlug = `${epub.language}-gutenberg-${gutenbergId}`;

      const [edition] = await tx
        .insert(editions)
        .values({
          bookId: book.id,

          slug: editionSlug,

          language: epub.language,

          title: epub.title,

          translator: epub.translator,

          publicationYear,

          coverUrl,

          sourceName: "Project Gutenberg",

          sourceIdentifier: gutenbergId,

          sourceUrl: `https://www.gutenberg.org/ebooks/${gutenbergId}`,

          copyrightStatus: "PENDING_REVIEW",

          publicationStatus: "DRAFT",

          copyrightNotes: "Imported for manual copyright and edition review before publication.",
        })
        .onConflictDoUpdate({
          target: [editions.sourceName, editions.sourceIdentifier],

          /*
           * IMPORTANT:
           *
           * We intentionally DON'T modify:
           *
           * copyrightStatus
           * publicationStatus
           * verifiedAt
           * copyrightNotes
           *
           * That means re-importing an already
           * approved book doesn't turn it back
           * into DRAFT.
           */
          set: {
            bookId: book.id,

            slug: editionSlug,

            language: epub.language,

            title: epub.title,

            translator: epub.translator,

            publicationYear,

            coverUrl,

            sourceUrl: `https://www.gutenberg.org/ebooks/${gutenbergId}`,

            updatedAt: new Date(),
          },
        })
        .returning();

      if (!edition) {
        throw new Error("Could not create or update edition");
      }

      /*
       * CHAPTERS
       *
       * Re-importing replaces the chapter
       * contents completely.
       */
      await tx.delete(chapters).where(eq(chapters.editionId, edition.id));

      const chapterRows = epub.chapters.map((chapter) => ({
        editionId: edition.id,

        number: chapter.number,

        slug: chapter.slug,

        title: chapter.title,

        content: chapter.content,

        wordCount: chapter.wordCount,
      }));

      /*
       * Insert in batches in case we later
       * import very large books.
       */
      const batchSize = 50;

      for (let index = 0; index < chapterRows.length; index += batchSize) {
        const batch = chapterRows.slice(index, index + batchSize);

        await tx.insert(chapters).values(batch);
      }

      console.log("");
      console.log("Database import staged for commit");

      console.log(`Book ID: ${book.id}`);

      console.log(`Edition ID: ${edition.id}`);

      console.log(`Chapters imported: ${chapterRows.length}`);

      console.log(`Cover URL: ${edition.coverUrl ?? "None"}`);

      console.log(`Copyright: ${edition.copyrightStatus}`);

      console.log(`Publication: ${edition.publicationStatus}`);
    });

    console.log("Database import committed.");

    // The book tag also covers replaced/deleted chapters in every locale.
    await revalidateEditorialCache([`book:${bookSlug}`, "library"]);
  } finally {
    await client.end();
  }
}
