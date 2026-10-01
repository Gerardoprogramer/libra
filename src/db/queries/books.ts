import "server-only";

import { and, asc, countDistinct, eq, exists, ilike, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { cacheLife, cacheTag } from "next/cache";

import { db } from "@/db";

import {
  authors,
  bookAuthors,
  bookCategories,
  books,
  categories,
  categoryTranslations,
  chapters,
  editions,
} from "@/db/schema";

export type ContentLocale = "es" | "en";

export interface BookFilters {
  query?: string;
  category?: string;
}

export interface BookCategory {
  id: string;
  slug: string;
  name: string;
}

export interface BookListItem {
  id: string;
  slug: string;
  title: string;
  author: string;
  year: number | null;
  language: string;
  coverUrl: string | null;
  categories: BookCategory[];
}

export interface CategoryListItem extends BookCategory {
  bookCount: number;
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

  categories: BookCategory[];

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

export interface AuthorDetails {
  id: string;
  slug: string;
  name: string;
  birthYear: number | null;
  deathYear: number | null;
  books: BookListItem[];
}

export interface AuthorListItem {
  id: string;
  slug: string;
  name: string;
  birthYear: number | null;
  deathYear: number | null;
  bookCount: number;
}

interface PositionedBookCategory extends BookCategory {
  position: number;
}

interface BookCategoryRow {
  categoryId: string | null;
  categorySlug: string | null;
  categoryName: string | null;
  fallbackCategoryName: string | null;
  categoryPosition: number | null;
}

const fallbackCategoryTranslations = alias(categoryTranslations, "fallback_category_translations");

function addBookCategory(categories: Map<string, PositionedBookCategory>, row: BookCategoryRow) {
  if (!row.categoryId || !row.categorySlug || row.categoryPosition === null) {
    return;
  }

  categories.set(row.categoryId, {
    id: row.categoryId,
    slug: row.categorySlug,
    name: row.categoryName ?? row.fallbackCategoryName ?? row.categorySlug,
    position: row.categoryPosition,
  });
}

function getBookCategories(categories: Map<string, PositionedBookCategory>): BookCategory[] {
  return Array.from(categories.values())
    .sort((first, second) => first.position - second.position)
    .map(({ id, slug, name }) => ({ id, slug, name }));
}

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

export async function getBooks(locale: ContentLocale, filters: BookFilters = {}): Promise<BookListItem[]> {
  "use cache";

  cacheLife("editorial");
  cacheTag("library:editorial");

  const query = filters.query?.trim();
  const category = filters.category?.trim();

  const rows = await db
    .select({
      bookId: books.id,

      bookSlug: books.slug,

      originalTitle: books.originalTitle,

      publicationYear: books.originalPublicationYear,

      authorId: authors.id,

      authorName: authors.name,

      authorPosition: bookAuthors.position,

      editionId: editions.id,

      editionTitle: editions.title,

      editionLanguage: editions.language,

      editionCoverUrl: editions.coverUrl,

      categoryId: categories.id,

      categorySlug: categories.slug,

      categoryName: categoryTranslations.name,

      fallbackCategoryName: fallbackCategoryTranslations.name,

      categoryPosition: bookCategories.position,
    })
    .from(books)

    .innerJoin(bookAuthors, eq(bookAuthors.bookId, books.id))

    .innerJoin(authors, eq(authors.id, bookAuthors.authorId))

    .innerJoin(editions, eq(editions.bookId, books.id))

    .leftJoin(bookCategories, eq(bookCategories.bookId, books.id))

    .leftJoin(categories, eq(categories.id, bookCategories.categoryId))

    .leftJoin(
      categoryTranslations,
      and(eq(categoryTranslations.categoryId, categories.id), eq(categoryTranslations.locale, locale)),
    )

    .leftJoin(
      fallbackCategoryTranslations,
      and(eq(fallbackCategoryTranslations.categoryId, categories.id), eq(fallbackCategoryTranslations.locale, "en")),
    )

    .where(
      and(
        getEditionVisibilityCondition(),

        query
          ? or(
              ilike(editions.title, `%${query}%`),

              ilike(books.originalTitle, `%${query}%`),

              ilike(authors.name, `%${query}%`),
            )
          : undefined,

        category
          ? exists(
              db
                .select({
                  categoryId: bookCategories.categoryId,
                })
                .from(bookCategories)
                .innerJoin(categories, eq(categories.id, bookCategories.categoryId))
                .where(and(eq(bookCategories.bookId, books.id), eq(categories.slug, category))),
            )
          : undefined,
      ),
    )

    .orderBy(asc(books.originalTitle), asc(bookAuthors.position), asc(bookCategories.position));

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

      categories: Map<
        string,
        {
          id: string;
          slug: string;
          name: string;
          position: number;
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

        categories: new Map(),
      };

      grouped.set(row.bookId, currentBook);
    }

    currentBook.authors.set(row.authorId, {
      name: row.authorName,

      position: row.authorPosition,
    });

    currentBook.editions.set(row.editionId, {
      language: row.editionLanguage,

      title: row.editionTitle,

      coverUrl: row.editionCoverUrl,
    });

    addBookCategory(currentBook.categories, row);
  }

  return Array.from(grouped.values()).flatMap((book) => {
    const selectedEdition = chooseEdition(Array.from(book.editions.values()), locale);

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

        categories: getBookCategories(book.categories),
      },
    ];
  });
}
export async function getCategories(locale: ContentLocale): Promise<CategoryListItem[]> {
  "use cache";

  cacheLife("editorial");
  cacheTag("library:editorial");
  const rows = await db
    .select({
      categoryId: categories.id,

      categorySlug: categories.slug,

      translationLocale: categoryTranslations.locale,

      translationName: categoryTranslations.name,

      bookId: bookCategories.bookId,
    })
    .from(categories)

    .leftJoin(categoryTranslations, eq(categoryTranslations.categoryId, categories.id))

    .innerJoin(bookCategories, eq(bookCategories.categoryId, categories.id))

    .innerJoin(books, eq(books.id, bookCategories.bookId))

    .innerJoin(editions, eq(editions.bookId, books.id))

    .where(getEditionVisibilityCondition())

    .orderBy(asc(categories.slug));

  const grouped = new Map<
    string,
    {
      id: string;

      slug: string;

      translations: Map<string, string>;

      books: Set<string>;
    }
  >();

  for (const row of rows) {
    let category = grouped.get(row.categoryId);

    if (!category) {
      category = {
        id: row.categoryId,

        slug: row.categorySlug,

        translations: new Map(),

        books: new Set(),
      };

      grouped.set(row.categoryId, category);
    }

    if (row.translationLocale && row.translationName) {
      category.translations.set(row.translationLocale, row.translationName);
    }

    category.books.add(row.bookId);
  }

  return Array.from(grouped.values())
    .map((category) => ({
      id: category.id,

      slug: category.slug,

      name: category.translations.get(locale) ?? category.translations.get("en") ?? category.slug,

      bookCount: category.books.size,
    }))

    .sort((first, second) => first.name.localeCompare(second.name));
}

export async function getBookBySlug(slug: string, locale: ContentLocale): Promise<BookDetails | null> {
  "use cache";

  cacheLife("editorial");
  cacheTag("library:editorial", `book:${slug}`);

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

    .where(
      and(
        eq(editions.bookId, book.id),

        getEditionVisibilityCondition(),
      ),
    );

  const edition = chooseEdition(editionRows, locale);

  if (!edition) {
    return null;
  }

  const categoryRows = await db
    .select({
      id: categories.id,

      slug: categories.slug,

      position: bookCategories.position,

      locale: categoryTranslations.locale,

      name: categoryTranslations.name,
    })

    .from(bookCategories)

    .innerJoin(categories, eq(categories.id, bookCategories.categoryId))

    .leftJoin(categoryTranslations, eq(categoryTranslations.categoryId, categories.id))

    .where(eq(bookCategories.bookId, book.id))

    .orderBy(asc(bookCategories.position));

  const categoryMap = new Map<
    string,
    {
      id: string;
      slug: string;
      position: number;
      translations: Map<string, string>;
    }
  >();

  for (const categoryRow of categoryRows) {
    let category = categoryMap.get(categoryRow.id);

    if (!category) {
      category = {
        id: categoryRow.id,

        slug: categoryRow.slug,

        position: categoryRow.position,

        translations: new Map(),
      };

      categoryMap.set(categoryRow.id, category);
    }

    if (categoryRow.locale && categoryRow.name) {
      category.translations.set(categoryRow.locale, categoryRow.name);
    }
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

    categories: Array.from(categoryMap.values())
      .sort((first, second) => first.position - second.position)
      .map((category) => ({
        id: category.id,

        slug: category.slug,

        name: category.translations.get(locale) ?? category.translations.get("en") ?? category.slug,
      })),

    edition,

    chapters: chapterRows,
  };
}

export async function getChapterBySlug(bookSlug: string, chapterSlug: string, locale: ContentLocale) {
  "use cache";

  cacheLife("editorial");

  cacheTag(`book:${bookSlug}`, `chapter:${bookSlug}:${chapterSlug}`, "library:editorial");

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

    .where(
      and(
        eq(chapters.editionId, book.edition.id),

        eq(chapters.slug, chapterSlug),
      ),
    )

    .limit(1);

  if (!chapter) {
    return null;
  }

  const chapterIndex = book.chapters.findIndex((item) => item.id === chapter.id);

  return {
    book,
    chapter,
    chapterIndex,

    previous: chapterIndex > 0 ? book.chapters[chapterIndex - 1] : null,

    next: chapterIndex < book.chapters.length - 1 ? book.chapters[chapterIndex + 1] : null,
  };
}

export async function getAuthors(): Promise<AuthorListItem[]> {
  "use cache";

  cacheLife("editorial");
  cacheTag("library:editorial");

  return db
    .select({
      id: authors.id,
      slug: authors.slug,
      name: authors.name,
      birthYear: authors.birthYear,
      deathYear: authors.deathYear,
      bookCount: countDistinct(books.id),
    })
    .from(authors)
    .innerJoin(bookAuthors, eq(bookAuthors.authorId, authors.id))
    .innerJoin(books, eq(books.id, bookAuthors.bookId))
    .innerJoin(editions, eq(editions.bookId, books.id))
    .where(getEditionVisibilityCondition())
    .groupBy(authors.id, authors.slug, authors.name, authors.birthYear, authors.deathYear)
    .orderBy(asc(authors.name));
}

export async function getAuthorBySlug(slug: string, locale: ContentLocale): Promise<AuthorDetails | null> {
  "use cache";

  cacheLife("editorial");

  cacheTag(`author:${slug}`, "library:editorial");

  const [author] = await db
    .select({
      id: authors.id,
      slug: authors.slug,
      name: authors.name,
      birthYear: authors.birthYear,
      deathYear: authors.deathYear,
    })
    .from(authors)
    .where(eq(authors.slug, slug))
    .limit(1);

  if (!author) {
    return null;
  }

  const rows = await db
    .select({
      bookId: books.id,
      bookSlug: books.slug,
      publicationYear: books.originalPublicationYear,

      editionId: editions.id,
      editionTitle: editions.title,
      editionLanguage: editions.language,
      editionCoverUrl: editions.coverUrl,

      categoryId: categories.id,
      categorySlug: categories.slug,
      categoryName: categoryTranslations.name,
      fallbackCategoryName: fallbackCategoryTranslations.name,
      categoryPosition: bookCategories.position,
    })
    .from(bookAuthors)
    .innerJoin(books, eq(books.id, bookAuthors.bookId))
    .innerJoin(editions, eq(editions.bookId, books.id))
    .leftJoin(bookCategories, eq(bookCategories.bookId, books.id))
    .leftJoin(categories, eq(categories.id, bookCategories.categoryId))
    .leftJoin(
      categoryTranslations,
      and(eq(categoryTranslations.categoryId, categories.id), eq(categoryTranslations.locale, locale)),
    )
    .leftJoin(
      fallbackCategoryTranslations,
      and(eq(fallbackCategoryTranslations.categoryId, categories.id), eq(fallbackCategoryTranslations.locale, "en")),
    )
    .where(and(eq(bookAuthors.authorId, author.id), getEditionVisibilityCondition()))
    .orderBy(asc(books.originalPublicationYear), asc(bookCategories.position));

  const grouped = new Map<
    string,
    {
      id: string;
      slug: string;
      year: number | null;
      editions: Map<
        string,
        {
          language: string;
          title: string;
          coverUrl: string | null;
        }
      >;
      categories: Map<
        string,
        {
          id: string;
          slug: string;
          name: string;
          position: number;
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
        editions: new Map(),
        categories: new Map(),
      };

      grouped.set(row.bookId, currentBook);
    }

    currentBook.editions.set(row.editionId, {
      language: row.editionLanguage,
      title: row.editionTitle,
      coverUrl: row.editionCoverUrl,
    });

    addBookCategory(currentBook.categories, row);
  }

  const authorBooks = Array.from(grouped.values()).flatMap((book) => {
    const selectedEdition = chooseEdition(Array.from(book.editions.values()), locale);

    if (!selectedEdition) {
      return [];
    }

    return [
      {
        id: book.id,
        slug: book.slug,
        title: selectedEdition.title,
        author: author.name,
        year: book.year,
        language: selectedEdition.language,
        coverUrl: selectedEdition.coverUrl,
        categories: getBookCategories(book.categories),
      },
    ];
  });

  if (authorBooks.length === 0) {
    return null;
  }

  return {
    ...author,
    books: authorBooks,
  };
}
