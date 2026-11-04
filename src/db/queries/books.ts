import "server-only";

import { and, asc, countDistinct, eq, exists, ilike, inArray, or, sql, type Column, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { cacheLife, cacheTag } from "next/cache";

import { db } from "@/db";
import { formatAuthorNames } from "@/lib/book-authors";
import {
  CATALOG_PAGE_SIZE,
  containsPattern,
  foldSearchText,
  normalizeCategorySlug,
  normalizeSearchQuery,
  SEARCH_IGNORED_MARKS,
} from "@/lib/catalog-filters";
import { chooseEdition } from "@/lib/edition-selection";

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

import { getPublicEditionVisibilityCondition } from "./editorial-visibility";

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
  /** Locales with a translated name. The slug is shared, so these are the category's real language versions. */
  locales: ContentLocale[];
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

    sourceIdentifier: string | null;

    sourceUrl: string | null;

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

/** Books with a public edition in the category with this slug. */
function inCategory(category: string) {
  return exists(
    db
      .select({
        categoryId: bookCategories.categoryId,
      })
      .from(bookCategories)
      .innerJoin(categories, eq(categories.id, bookCategories.categoryId))
      .where(and(eq(bookCategories.bookId, books.id), eq(categories.slug, category))),
  );
}

// The marks translate() deletes are built from code points (SEARCH_IGNORED_MARKS), never from a request, and are
// written as a literal, so the expression is the same text in every statement. Checked when the module loads: only
// combining marks of U+0300-U+036F (never a quote, a backslash or a letter that would vanish from stored text), all
// of them, each once and in order. Its counterpart is '', so translate() can only delete them, never substitute.
if (
  Array.from(SEARCH_IGNORED_MARKS).length !== 0x036f - 0x0300 + 1 ||
  !/^[\u0300-\u036f]+$/u.test(SEARCH_IGNORED_MARKS) ||
  !Array.from(SEARCH_IGNORED_MARKS).every((mark, index, marks) => index === 0 || mark > marks[index - 1])
) {
  throw new Error("The ignored search marks must be distinct combining marks of U+0300-U+036F, in order.");
}

const ignoredMarks = sql.raw(`'${SEARCH_IGNORED_MARKS}'`);

/**
 * Whether a stored column contains the search, both compared folded: the column with
 * translate(lower(normalize(column, NFD)), SEARCH_IGNORED_MARKS, ''), the search with foldSearchText, which is the
 * same steps in JavaScript. Case and accents are ignored, NFC and NFD forms are the same text, and the stored value
 * itself is never changed. `search` must already be folded; it only reaches SQL as a parameter, escaped by
 * containsPattern so `%`, `_` and `\` match literally.
 *
 * normalize() needs a UTF8 database (production is). Decomposing before lower() leaves the base of every accented
 * Latin letter in ASCII, so that part does not depend on the database's locale; lower() of other uppercase letters
 * (Greek, Cyrillic, ø, ł) follows its locale provider, which in production is ICU, as JavaScript's toLowerCase is.
 * Both sides follow their own Unicode version: letters newer than the database's ICU may lowercase differently.
 */
function containsSearch(column: Column, search: string) {
  return ilike(sql`translate(lower(normalize(${column}, NFD)), ${ignoredMarks}, '')`, containsPattern(search));
}

/**
 * The search condition for a normalized query: none for an empty one, `false` for one that folds to nothing (only
 * combining marks: still a search, which matches no book rather than every book), else `conditions(folded)`.
 */
function searchCondition(query: string, conditions: (search: string) => SQL | undefined): SQL | undefined {
  if (!query) return undefined;

  const search = foldSearchText(query);

  return search ? conditions(search) : sql`false`;
}

/** Books with a public edition whose title contains the (folded) search. */
function hasPublicEditionTitled(search: string) {
  return exists(
    db
      .select({ id: editions.id })
      .from(editions)
      .where(
        and(
          eq(editions.bookId, books.id),
          getPublicEditionVisibilityCondition(),
          containsSearch(editions.title, search),
        ),
      ),
  );
}

// One row per book × author × public edition × category, the shape the catalog cards are grouped from. A LIMIT here
// would count those rows instead of books, so a page of books is chosen first (getBookPage) and only then expanded.
function selectBookListRows(locale: ContentLocale, ...conditions: (SQL | undefined)[]) {
  return (
    db
      .select({
        bookId: books.id,

        bookSlug: books.slug,

        originalTitle: books.originalTitle,

        publicationYear: books.originalPublicationYear,

        authorId: authors.id,

        authorName: authors.name,

        authorPosition: bookAuthors.position,

        editionId: editions.id,

        editionSlug: editions.slug,

        editionTitle: editions.title,

        editionLanguage: editions.language,

        editionIsPreferred: editions.isPreferred,

        editionCreatedAt: editions.createdAt,

        editionCoverUrl: editions.coverUrl,

        categoryId: categories.id,

        categorySlug: categories.slug,

        categoryName: categoryTranslations.name,

        fallbackCategoryName: fallbackCategoryTranslations.name,

        categoryPosition: bookCategories.position,
      })
      .from(books)

      // Left joins: an anonymous work has no authors and is still listed.
      .leftJoin(bookAuthors, eq(bookAuthors.bookId, books.id))

      .leftJoin(authors, eq(authors.id, bookAuthors.authorId))

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

      .where(and(getPublicEditionVisibilityCondition(), ...conditions))

      .orderBy(asc(books.originalTitle), asc(bookAuthors.position), asc(bookCategories.position))
  );
}

type BookListRow = Awaited<ReturnType<typeof selectBookListRows>>[number];

/** One catalog card per book, in the order of the rows, with the edition chosen for the locale. */
function groupBookListItems(rows: BookListRow[], locale: ContentLocale): BookListItem[] {
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
          slug: string;
          language: string;
          isPreferred: boolean;
          createdAt: Date;
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

    if (row.authorId !== null && row.authorName !== null && row.authorPosition !== null) {
      currentBook.authors.set(row.authorId, {
        name: row.authorName,

        position: row.authorPosition,
      });
    }

    currentBook.editions.set(row.editionId, {
      slug: row.editionSlug,
      language: row.editionLanguage,
      isPreferred: row.editionIsPreferred,
      createdAt: row.editionCreatedAt,
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

    const author = formatAuthorNames(
      Array.from(book.authors.values())
        .sort((first, second) => first.position - second.position)
        .map((item) => item.name),
      locale,
    );

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

export async function getBooks(locale: ContentLocale, filters: BookFilters = {}): Promise<BookListItem[]> {
  "use cache";

  cacheLife("editorial");
  cacheTag("library:editorial");

  // Bounded and wildcard-free: callers normalize first (a cache key is made of the raw arguments), and this
  // repeats it so no caller can put an unbounded or wildcard-bearing pattern into SQL.
  const query = normalizeSearchQuery(filters.query);
  const category = normalizeCategorySlug(filters.category);

  const rows = await selectBookListRows(
    locale,

    searchCondition(query, (search) =>
      or(
        containsSearch(books.originalTitle, search),
        containsSearch(authors.name, search),
        hasPublicEditionTitled(search),
      ),
    ),

    category ? inCategory(category) : undefined,
  );

  return groupBookListItems(rows, locale);
}

export interface BookPage {
  books: BookListItem[];
  /** Books matching the filters, across every page. */
  total: number;
  page: number;
  pageSize: number;
  /** At least 1: an empty listing still has its first page. */
  totalPages: number;
}

/**
 * One page of the catalog, in an order that does not depend on the locale (original title, then id), so a page holds
 * the same books in every language. The books of the page are chosen on `books` alone, every filter an EXISTS, and
 * only those are expanded into cards; the total comes from the same statement as the page.
 */
export async function getBookPage(
  locale: ContentLocale,
  filters: BookFilters & { page?: number } = {},
): Promise<BookPage> {
  "use cache";

  cacheLife("editorial");
  cacheTag("library:editorial");

  const query = normalizeSearchQuery(filters.query);
  const category = normalizeCategorySlug(filters.category);
  // Callers parse the page (parseCatalogPage); anything else that reaches here is the first page.
  const page = filters.page !== undefined && Number.isSafeInteger(filters.page) && filters.page > 1 ? filters.page : 1;
  const pageSize = CATALOG_PAGE_SIZE;

  const condition = and(
    exists(
      db
        .select({ id: editions.id })
        .from(editions)
        .where(and(eq(editions.bookId, books.id), getPublicEditionVisibilityCondition())),
    ),

    searchCondition(query, (search) =>
      or(
        containsSearch(books.originalTitle, search),
        exists(
          db
            .select({ bookId: bookAuthors.bookId })
            .from(bookAuthors)
            .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
            .where(and(eq(bookAuthors.bookId, books.id), containsSearch(authors.name, search))),
        ),
        hasPublicEditionTitled(search),
      ),
    ),

    category ? inCategory(category) : undefined,
  );

  // The window count is taken with the page itself, so the total always describes the books returned.
  const pageRows = await db
    .select({
      id: books.id,
      total: sql<number>`count(*) over()`.mapWith(Number),
    })
    .from(books)
    .where(condition)
    .orderBy(asc(books.originalTitle), asc(books.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  let total = pageRows[0]?.total;

  if (total === undefined) {
    // An empty page has no row to carry the count: only a count tells an empty listing from a page past the last.
    total =
      page === 1
        ? 0
        : ((
            await db
              .select({ total: sql<number>`count(*)`.mapWith(Number) })
              .from(books)
              .where(condition)
          )[0]?.total ?? 0);
  }

  const ids = pageRows.map((row) => row.id);
  const cards =
    ids.length > 0 ? groupBookListItems(await selectBookListRows(locale, inArray(books.id, ids)), locale) : [];
  const cardsById = new Map(cards.map((card) => [card.id, card]));

  return {
    books: ids.flatMap((id) => cardsById.get(id) ?? []),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
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

    .where(getPublicEditionVisibilityCondition())

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

      locales: (["en", "es"] as ContentLocale[]).filter((item) => category.translations.has(item)),
    }))

    .sort((first, second) => first.name.localeCompare(second.name));
}

export async function getBookBySlug(
  slug: string,
  locale: ContentLocale,
  editionId?: string,
): Promise<BookDetails | null> {
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

      isPreferred: editions.isPreferred,

      createdAt: editions.createdAt,

      title: editions.title,

      description: editions.description,

      translator: editions.translator,

      publicationYear: editions.publicationYear,

      coverUrl: editions.coverUrl,

      sourceName: editions.sourceName,

      sourceIdentifier: editions.sourceIdentifier,

      sourceUrl: editions.sourceUrl,

      copyrightStatus: editions.copyrightStatus,
    })

    .from(editions)

    .where(
      and(
        eq(editions.bookId, book.id),

        getPublicEditionVisibilityCondition(),
      ),
    );

  const edition = editionId ? editionRows.find((item) => item.id === editionId) : chooseEdition(editionRows, locale);

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

export async function getChapterBySlug(
  bookSlug: string,
  chapterSlug: string,
  locale: ContentLocale,
  editionId?: string,
) {
  "use cache";

  cacheLife("editorial");

  cacheTag(`book:${bookSlug}`, `chapter:${bookSlug}:${chapterSlug}`, "library:editorial");

  const book = await getBookBySlug(bookSlug, locale, editionId);

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

/** Whether any public edition of the book has a chapter with this slug. Cheap enough to decide a 404 early. */
export async function chapterExistsInPublicEdition(bookSlug: string, chapterSlug: string): Promise<boolean> {
  "use cache";

  cacheLife("editorial");
  cacheTag(`book:${bookSlug}`, `chapter:${bookSlug}:${chapterSlug}`, "library:editorial");

  const [row] = await db
    .select({ id: chapters.id })
    .from(chapters)
    .innerJoin(editions, eq(editions.id, chapters.editionId))
    .innerJoin(books, eq(books.id, editions.bookId))
    .where(and(eq(books.slug, bookSlug), eq(chapters.slug, chapterSlug), getPublicEditionVisibilityCondition()))
    .limit(1);

  return Boolean(row);
}

export interface LocalizedChapterPath {
  /** Path without the locale prefix. */
  pathname: string;
  /** True only when the destination is the very same chapter; false when it is a safe fallback. */
  exact: boolean;
}

/**
 * Where to go when the reader switches interface language.
 *
 * The same chapter is only certain when both locales resolve to the same edition. Two editions of a book
 * (an original and a translation, or two translations) are different texts whose chapters are split and
 * numbered differently, so chapter numbers never identify the same passage. In that case the safe,
 * coherent destination is the book page in the target language, which lists that edition's chapters.
 */
export async function getLocalizedChapterPath(
  bookSlug: string,
  chapterSlug: string,
  fromLocale: ContentLocale,
  toLocale: ContentLocale,
  fromEditionId?: string,
): Promise<LocalizedChapterPath | null> {
  "use cache";

  cacheLife("editorial");
  cacheTag(`book:${bookSlug}`, "library:editorial");

  const sourceBook = await getBookBySlug(bookSlug, fromLocale, fromEditionId);

  if (!sourceBook) {
    return null;
  }

  const sourceChapter = sourceBook.chapters.find((chapter) => chapter.slug === chapterSlug);

  if (!sourceChapter) {
    return null;
  }

  const targetBook = await getBookBySlug(bookSlug, toLocale);

  if (!targetBook) {
    return null;
  }

  if (sourceBook.edition.id === targetBook.edition.id) {
    return {
      pathname: `/books/${encodeURIComponent(bookSlug)}/${encodeURIComponent(sourceChapter.slug)}`,
      exact: true,
    };
  }

  return { pathname: `/books/${encodeURIComponent(bookSlug)}`, exact: false };
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
    .where(getPublicEditionVisibilityCondition())
    .groupBy(authors.id, authors.slug, authors.name, authors.birthYear, authors.deathYear)
    .orderBy(asc(authors.name));
}

export async function getSitemapContent(): Promise<{
  books: {
    slug: string;
    locales: ContentLocale[];
  }[];
  chapters: {
    bookSlug: string;
    slug: string;
    locale: ContentLocale;
  }[];
  authorSlugs: string[];
}> {
  "use cache";

  cacheLife("editorial");
  cacheTag("library:editorial");

  const visibilityCondition = getPublicEditionVisibilityCondition();

  const [editionRows, authorRows] = await Promise.all([
    db
      .select({
        bookId: books.id,
        bookSlug: books.slug,
        id: editions.id,
        language: editions.language,
        slug: editions.slug,
        isPreferred: editions.isPreferred,
        createdAt: editions.createdAt,
      })
      .from(books)
      .innerJoin(editions, eq(editions.bookId, books.id))
      .where(visibilityCondition)
      .orderBy(asc(books.slug), asc(editions.slug)),

    db
      .selectDistinct({ slug: authors.slug })
      .from(authors)
      .innerJoin(bookAuthors, eq(bookAuthors.authorId, authors.id))
      .innerJoin(books, eq(books.id, bookAuthors.bookId))
      .innerJoin(editions, eq(editions.bookId, books.id))
      .where(visibilityCondition)
      .orderBy(asc(authors.slug)),
  ]);

  const editionsByBookId = new Map<
    string,
    {
      slug: string;
      editions: (typeof editionRows)[number][];
    }
  >();

  for (const row of editionRows) {
    const book = editionsByBookId.get(row.bookId);

    if (book) {
      book.editions.push(row);
    } else {
      editionsByBookId.set(row.bookId, {
        slug: row.bookSlug,
        editions: [row],
      });
    }
  }

  const sitemapBooks: {
    slug: string;
    locales: ContentLocale[];
  }[] = [];

  const selectedEditionById = new Map<
    string,
    {
      bookSlug: string;
      locale: ContentLocale;
    }
  >();

  for (const { slug, editions: bookEditions } of editionsByBookId.values()) {
    const availableLocales = new Set<ContentLocale>();

    for (const edition of bookEditions) {
      const language = edition.language.toLowerCase().split("-")[0];

      if (language === "en" || language === "es") {
        availableLocales.add(language);
      }
    }

    const locales = (["en", "es"] as ContentLocale[]).filter((locale) => availableLocales.has(locale));

    if (locales.length === 0) {
      continue;
    }

    sitemapBooks.push({
      slug,
      locales,
    });

    for (const locale of locales) {
      const selectedEdition = chooseEdition(bookEditions, locale);

      if (!selectedEdition) {
        continue;
      }

      selectedEditionById.set(selectedEdition.id, {
        bookSlug: slug,
        locale,
      });
    }
  }

  const chapterRows =
    selectedEditionById.size > 0
      ? await db
          .select({
            editionId: chapters.editionId,
            slug: chapters.slug,
            number: chapters.number,
          })
          .from(chapters)
          .where(inArray(chapters.editionId, Array.from(selectedEditionById.keys())))
          .orderBy(asc(chapters.editionId), asc(chapters.number))
      : [];

  const sitemapChapters = chapterRows.flatMap((chapter) => {
    const selectedEdition = selectedEditionById.get(chapter.editionId);

    if (!selectedEdition) {
      return [];
    }

    return [
      {
        bookSlug: selectedEdition.bookSlug,
        slug: chapter.slug,
        locale: selectedEdition.locale,
      },
    ];
  });

  return {
    books: sitemapBooks,
    chapters: sitemapChapters,
    authorSlugs: authorRows.map(({ slug }) => slug),
  };
}

export async function getBookContentLocales(slug: string): Promise<ContentLocale[]> {
  "use cache";

  cacheLife("editorial");
  cacheTag(`book:${slug}`, "library:editorial");

  const rows = await db
    .selectDistinct({
      language: editions.language,
    })
    .from(editions)
    .innerJoin(books, eq(books.id, editions.bookId))
    .where(and(eq(books.slug, slug), getPublicEditionVisibilityCondition()))
    .orderBy(asc(editions.language));

  const locales = new Set<ContentLocale>();

  for (const row of rows) {
    const language = row.language.toLowerCase().split("-")[0];

    if (language === "en" || language === "es") {
      locales.add(language);
    }
  }

  return Array.from(locales);
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
      editionSlug: editions.slug,
      editionTitle: editions.title,
      editionLanguage: editions.language,
      editionIsPreferred: editions.isPreferred,
      editionCreatedAt: editions.createdAt,
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
    .where(and(eq(bookAuthors.authorId, author.id), getPublicEditionVisibilityCondition()))
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
          slug: string;
          language: string;
          isPreferred: boolean;
          createdAt: Date;
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
      slug: row.editionSlug,
      language: row.editionLanguage,
      isPreferred: row.editionIsPreferred,
      createdAt: row.editionCreatedAt,
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
