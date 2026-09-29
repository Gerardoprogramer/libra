import "server-only";

import { and, asc, eq, or } from "drizzle-orm";

import { db } from "@/db";
import { authors, bookAuthors, books, chapters, editions } from "@/db/schema";

export type ContentLocale = "es" | "en";

function getEditionVisibilityCondition() {
  if (process.env.NODE_ENV === "development") {
    return undefined;
  }

  return and(
    eq(editions.publicationStatus, "PUBLISHED"),
    or(
      eq(editions.copyrightStatus, "PUBLIC_DOMAIN_VERIFIED"),
      eq(editions.copyrightStatus, "LICENSED"),
      eq(editions.copyrightStatus, "ORIGINAL"),
    ),
  );
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

export interface BookDetails {
  id: string;
  slug: string;
  originalTitle: string;
  originalLanguage: string;
  originalPublicationYear: number | null;

  authors: {
    id: string;
    slug: string;
    name: string;
  }[];

  edition: {
    id: string;
    slug: string;
    language: string;
    title: string;
    description: string | null;
    translator: string | null;
    publicationYear: number | null;
    coverUrl: string | null;
    sourceName: string | null;
    copyrightStatus: "PUBLIC_DOMAIN_VERIFIED" | "LICENSED" | "ORIGINAL" | "PENDING_REVIEW" | "REJECTED";
  };

  chapters: {
    id: string;
    slug: string;
    number: number;
    title: string;
  }[];
}

function chooseEdition<
  T extends {
    language: string;
  },
>(availableEditions: T[], locale: ContentLocale) {
  return (
    availableEditions.find((edition) => edition.language === locale) ??
    availableEditions.find((edition) => edition.language === "en") ??
    availableEditions[0]
  );
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
          language: string;
          title: string;
          coverUrl: string | null;
        }
      >;
    }
  >();

  for (const row of rows) {
    let currentBook = grouped.get(row.bookId);

    if (!currentBook) {
      currentBook = {
        id: row.bookId,
        slug: row.bookSlug,
        year: row.publicationYear,
        authors: new Map(),
        editions: new Map(),
      };

      grouped.set(row.bookId, currentBook);
    }

    currentBook.authors.set(row.authorId, {
      name: row.authorName,
      position: row.authorPosition,
    });

    currentBook.editions.set(row.editionId, {
      title: row.editionTitle,
      language: row.editionLanguage,
      coverUrl: row.editionCoverUrl,
    });
  }

  return Array.from(grouped.values()).flatMap((book) => {
    const availableEditions = Array.from(book.editions.values());

    const selectedEdition = chooseEdition(availableEditions, locale);

    if (!selectedEdition) {
      return [];
    }

    const author = Array.from(book.authors.values())
      .sort((first, second) => first.position - second.position)
      .map((item) => item.name)
      .join(", ");

    return [
      {
        id: book.id,
        slug: book.slug,
        title: selectedEdition.title,
        author,
        year: book.year,
        language: selectedEdition.language,
        coverUrl: selectedEdition.coverUrl,
      },
    ];
  });
}

export async function getBookBySlug(slug: string, locale: ContentLocale): Promise<BookDetails | null> {
  const [book] = await db
    .select({
      id: books.id,
      slug: books.slug,
      originalTitle: books.originalTitle,
      originalLanguage: books.originalLanguage,
      originalPublicationYear: books.originalPublicationYear,
    })
    .from(books)
    .where(eq(books.slug, slug))
    .limit(1);

  if (!book) {
    return null;
  }

  const bookAuthorRows = await db
    .select({
      id: authors.id,
      slug: authors.slug,
      name: authors.name,
      position: bookAuthors.position,
    })
    .from(bookAuthors)
    .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
    .where(eq(bookAuthors.bookId, book.id))
    .orderBy(asc(bookAuthors.position));

  const editionRows = await db
    .select({
      id: editions.id,
      slug: editions.slug,
      language: editions.language,
      title: editions.title,
      description: editions.description,
      translator: editions.translator,
      publicationYear: editions.publicationYear,
      coverUrl: editions.coverUrl,
      sourceName: editions.sourceName,
      copyrightStatus: editions.copyrightStatus,
    })
    .from(editions)
    .where(and(eq(editions.bookId, book.id), getEditionVisibilityCondition()));

  const edition = chooseEdition(editionRows, locale);

  if (!edition) {
    return null;
  }

  const chapterRows = await db
    .select({
      id: chapters.id,
      slug: chapters.slug,
      number: chapters.number,
      title: chapters.title,
    })
    .from(chapters)
    .where(eq(chapters.editionId, edition.id))
    .orderBy(asc(chapters.number));

  return {
    ...book,

    authors: bookAuthorRows.map((author) => ({
      id: author.id,
      slug: author.slug,
      name: author.name,
    })),

    edition,

    chapters: chapterRows,
  };
}

export async function getChapterBySlug(bookSlug: string, chapterSlug: string, locale: ContentLocale) {
  const book = await getBookBySlug(bookSlug, locale);

  if (!book) {
    return null;
  }

  const [chapter] = await db
    .select({
      id: chapters.id,
      slug: chapters.slug,
      number: chapters.number,
      title: chapters.title,
      content: chapters.content,
    })
    .from(chapters)
    .where(and(eq(chapters.editionId, book.edition.id), eq(chapters.slug, chapterSlug)))
    .limit(1);

  if (!chapter) {
    return null;
  }

  const chapterIndex = book.chapters.findIndex((item) => item.id === chapter.id);

  return {
    book,
    chapter,

    previous: chapterIndex > 0 ? book.chapters[chapterIndex - 1] : null,

    next: chapterIndex < book.chapters.length - 1 ? book.chapters[chapterIndex + 1] : null,
  };
}
