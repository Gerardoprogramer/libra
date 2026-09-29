import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { authors, bookAuthors, books, chapters, editions } from "@/db/schema";

export type ContentLocale = "es" | "en";

const publicCopyrightStatuses = ["PUBLIC_DOMAIN_VERIFIED", "LICENSED", "ORIGINAL"] as const;

function getEditionVisibilityCondition() {
  if (process.env.NODE_ENV === "development") {
    // Nos permite visualizar los seeds DRAFT/PENDING_REVIEW localmente.
    return undefined;
  }

  return and(eq(editions.publicationStatus, "PUBLISHED"), inArray(editions.copyrightStatus, publicCopyrightStatuses));
}

export interface BookListItem {
  id: string;
  slug: string;
  title: string;
  author: string;
  year: number | null;
  language: string;
  coverUrl: string | null;
}

export async function getBooks(locale: ContentLocale): Promise<BookListItem[]> {
  const rows = await db
    .select({
      bookId: books.id,
      bookSlug: books.slug,
      publicationYear: books.originalPublicationYear,

      authorId: authors.id,
      authorName: authors.name,
      authorPosition: bookAuthors.position,

      editionId: editions.id,
      editionTitle: editions.title,
      editionLanguage: editions.language,
      editionCoverUrl: editions.coverUrl,
    })
    .from(books)
    .innerJoin(bookAuthors, eq(bookAuthors.bookId, books.id))
    .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
    .innerJoin(editions, eq(editions.bookId, books.id))
    .where(getEditionVisibilityCondition())
    .orderBy(asc(books.originalTitle), asc(bookAuthors.position));

  const grouped = new Map<
    string,
    {
      id: string;
      slug: string;
      year: number | null;
      authors: Map<
        string,
        {
          name: string;
          position: number;
        }
      >;
      editions: Map<
        string,
        {
          title: string;
          language: string;
          coverUrl: string | null;
        }
      >;
    }
  >();

  for (const row of rows) {
    let book = grouped.get(row.bookId);

    if (!book) {
      book = {
        id: row.bookId,
        slug: row.bookSlug,
        year: row.publicationYear,
        authors: new Map(),
        editions: new Map(),
      };

      grouped.set(row.bookId, book);
    }

    book.authors.set(row.authorId, {
      name: row.authorName,
      position: row.authorPosition,
    });

    book.editions.set(row.editionId, {
      title: row.editionTitle,
      language: row.editionLanguage,
      coverUrl: row.editionCoverUrl,
    });
  }

  return Array.from(grouped.values()).map((book) => {
    const availableEditions = Array.from(book.editions.values());

    const selectedEdition =
      availableEditions.find((edition) => edition.language === locale) ??
      availableEditions.find((edition) => edition.language === "en") ??
      availableEditions[0];

    const authorNames = Array.from(book.authors.values())
      .sort((a, b) => a.position - b.position)
      .map((author) => author.name);

    return {
      id: book.id,
      slug: book.slug,
      title: selectedEdition.title,
      author: authorNames.join(", "),
      year: book.year,
      language: selectedEdition.language,
      coverUrl: selectedEdition.coverUrl,
    };
  });
}
