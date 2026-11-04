import { Suspense } from "react";
import type { Metadata } from "next";

import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { FiSearch } from "react-icons/fi";

import { BookCard } from "@/components/books/BookCard";
import { CatalogPagination } from "@/components/books/CatalogPagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { getBookPage, getCategories, type CategoryListItem, type ContentLocale } from "@/db/queries/books";

import { Link } from "@/i18n/navigation";
import { getCatalogPath, normalizeCategorySlug, normalizeSearchQuery, parseCatalogPage } from "@/lib/catalog-filters";
import { createLocalizedMetadata } from "@/lib/seo-metadata";

interface CatalogSearchParams {
  q?: string | string[];
  category?: string | string[];
  page?: string | string[];
}

interface BooksPageProps {
  params: Promise<{
    locale: string;
  }>;
  searchParams: Promise<CatalogSearchParams>;
}

interface BooksContentProps {
  searchParams: Promise<CatalogSearchParams>;
}

// The category named by ?category=, among those with public books; null when it names none. getCategories is cached,
// so the metadata and the page share one query.
async function findCatalogCategory(locale: ContentLocale, slug: string): Promise<CategoryListItem | null> {
  return (await getCategories(locale)).find((category) => category.slug === slug) ?? null;
}

/**
 * The listing a request names, or null when it names none: a category without public books, a page that is not a
 * plain number, or a page past the last. Page 1 always exists, so it needs no count. The query arguments are the ones
 * the page renders with, so the count here and the books shown come from the same cache entry.
 */
async function resolveCatalogListing(locale: ContentLocale, searchParams: CatalogSearchParams) {
  const page = parseCatalogPage(searchParams.page);
  const query = normalizeSearchQuery(searchParams.q);
  const categorySlug = normalizeCategorySlug(searchParams.category);

  if (page === null) return null;

  const category = categorySlug ? await findCatalogCategory(locale, categorySlug) : null;

  if (categorySlug && !category) return null;

  if (page > 1 && page > (await getBookPage(locale, { query, category: categorySlug, page })).totalPages) {
    return null;
  }

  return { page, query, category };
}

export async function generateMetadata({ params, searchParams }: BooksPageProps): Promise<Metadata> {
  const { locale: routeLocale } = await params;
  const requested = await searchParams;
  const { q } = requested;

  const locale: ContentLocale = routeLocale === "en" ? "en" : "es";

  const [t, errors, listing] = await Promise.all([
    getTranslations({
      locale,
      namespace: "catalog",
    }),
    getTranslations({
      locale,
      namespace: "errors",
    }),
    resolveCatalogListing(locale, requested),
  ]);

  if (!listing) {
    // The page raises notFound(), and the head of that 404 comes from src/app/[locale]/not-found.tsx: Next.js does not
    // use this metadata for a not-found render. It stays noindex without canonical so nothing here can index the URL.
    return createLocalizedMetadata({
      locale,
      pathname: "/books",
      title: errors("notFoundTitle"),
      robots: {
        index: false,
        follow: true,
      },
      alternateLocales: false,
    });
  }

  const { page, category } = listing;
  // From page 2 each page has a title of its own; page 1 keeps the listing's.
  const withPage = (title: string) => (page > 1 ? `${title} — ${t("pageTitleSuffix", { page })}` : title);

  const hasSearchQuery =
    typeof q === "string" ? q.trim().length > 0 : Array.isArray(q) && q.some((value) => value.trim().length > 0);

  // A search, with or without a category, on any page, is never indexed and announces no language versions.
  if (hasSearchQuery) {
    return createLocalizedMetadata({
      locale,
      pathname: "/books",
      title: withPage(t("booksMetadataTitle")),
      description: t("booksMetadataDescription"),
      robots: {
        index: false,
        follow: true,
      },
      alternateLocales: false,
    });
  }

  // Each page is its own canonical URL (page 1 without ?page=). Its language versions are the same page in the other
  // locale: the order does not depend on the locale, so the same page number holds the same books.
  if (category) {
    // The category is its own page: its canonical keeps the filter. The slug is shared by every locale, so the
    // language versions are the locales the category has a translated name in, and only if this is one of them.
    const languageVersions = category.locales.includes(locale) ? category.locales : [];

    return createLocalizedMetadata({
      locale,
      pathname: getCatalogPath({ category: category.slug, page }),
      title: withPage(t("categoryMetadataTitle", { category: category.name })),
      description: t("categoryMetadataDescription", { category: category.name }),
      alternateLocales: languageVersions.length > 1 ? languageVersions : false,
    });
  }

  return createLocalizedMetadata({
    locale,
    pathname: getCatalogPath({ page }),
    title: withPage(t("booksMetadataTitle")),
    description: t("booksMetadataDescription"),
  });
}

export default async function BooksPage({ searchParams }: BooksContentProps) {
  // A category or page that names none raises notFound() before the Suspense boundary below. Googlebot
  // (htmlLimitedBots) gets a blocking render and a real 404; a browser has already received the prerendered shell with
  // a 200, so it gets the not-found page in that 200 (docs/seo.md, "Categorías inexistentes: limitación conocida").
  if (!(await resolveCatalogListing((await getLocale()) as ContentLocale, await searchParams))) {
    notFound();
  }

  return (
    <Suspense fallback={<BooksPageFallback />}>
      <BooksContent searchParams={searchParams} />
    </Suspense>
  );
}

async function BooksContent({ searchParams }: BooksContentProps) {
  const locale = (await getLocale()) as ContentLocale;
  const t = await getTranslations("catalog");

  const params = await searchParams;

  // Bounded here as well as in the query: each distinct value would otherwise be its own cache entry. BooksPage has
  // already refused a page that does not exist; the same arguments reuse the cache entry it counted with.
  const query = normalizeSearchQuery(params.q);
  const selectedCategory = normalizeCategorySlug(params.category);
  const page = parseCatalogPage(params.page) ?? 1;

  const [{ books, total, pageSize, totalPages }, categories] = await Promise.all([
    getBookPage(locale, {
      query,
      category: selectedCategory,
      page,
    }),
    getCategories(locale),
  ]);

  const firstShown = (page - 1) * pageSize + 1;

  const hasFilters = Boolean(query || selectedCategory);

  return (
    <main id="main-content" className="mx-auto min-h-screen max-w-7xl px-6 py-14 md:py-20">
      <header className="max-w-3xl">
        <p className="text-muted-foreground eyebrow mb-3">{t("eyebrow")}</p>

        <h1 className="page-title">{t("title")}</h1>

        <p className="text-muted-foreground mt-5 max-w-2xl text-lg leading-8">{t("description")}</p>
      </header>

      <form method="get" className="mt-10 flex flex-col gap-3 border-y py-6 md:flex-row">
        <div className="relative flex-1">
          <FiSearch
            aria-hidden="true"
            className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
          />

          <label className="sr-only" htmlFor="book-search">
            {t("searchLabel")}
          </label>

          <Input id="book-search" name="q" defaultValue={query} placeholder={t("searchPlaceholder")} className="pl-9" />
        </div>

        <label className="sr-only" htmlFor="book-category">
          {t("categoryFilterLabel")}
        </label>

        <select
          id="book-category"
          name="category"
          defaultValue={selectedCategory}
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px]"
        >
          <option value="">{t("allCategories")}</option>

          {categories.map((category) => (
            <option key={category.id} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>

        <Button type="submit">
          <FiSearch aria-hidden="true" />
          {t("search")}
        </Button>

        {hasFilters && (
          <Button variant="ghost" asChild>
            <Link href="/books">{t("clear")}</Link>
          </Button>
        )}
      </form>

      <div className="mt-8 mb-8 flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {t("results", {
            count: total,
          })}
        </p>
      </div>

      {books.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {books.map((book, index) => (
            <BookCard
              key={book.id}
              book={book}
              eager={index < 2}
              preload={index === 0}
              fetchPriority={index === 0 ? undefined : "auto"}
            />
          ))}
        </div>
      ) : (
        <div className="flex min-h-72 items-center justify-center border-y">
          <p className="text-muted-foreground">{t("noResults")}</p>
        </div>
      )}

      {books.length > 0 && (
        <p className="text-muted-foreground mt-10 text-sm">
          {t("resultsRange", { from: firstShown, to: firstShown + books.length - 1, total })}
        </p>
      )}

      <CatalogPagination
        page={page}
        totalPages={totalPages}
        category={selectedCategory}
        query={query}
        labels={{
          navigation: t("pagination"),
          previous: t("previous"),
          next: t("next"),
          previousPage: t("previousPage"),
          nextPage: t("nextPage"),
          goToPage: (target) => t("goToPage", { page: target }),
          currentPage: (target) => t("currentPage", { page: target }),
          pageOf: (current, pages) => t("pageOf", { page: current, totalPages: pages }),
        }}
      />
    </main>
  );
}

function BooksPageFallback() {
  return (
    <main id="main-content" className="mx-auto min-h-screen max-w-7xl px-6 py-14 md:py-20">
      <header className="max-w-3xl">
        <div className="bg-muted h-3 w-28 animate-pulse rounded" />
        <div className="bg-muted mt-5 h-14 w-72 max-w-full animate-pulse rounded" />
        <div className="bg-muted mt-5 h-6 w-full max-w-xl animate-pulse rounded" />
      </header>

      <div className="mt-10 flex gap-3 border-y py-6">
        <div className="bg-muted h-9 flex-1 animate-pulse rounded-md" />
        <div className="bg-muted hidden h-9 w-48 animate-pulse rounded-md md:block" />
        <div className="bg-muted h-9 w-24 animate-pulse rounded-md" />
      </div>

      <div className="mt-8 mb-8">
        <div className="bg-muted h-4 w-24 animate-pulse rounded" />
      </div>

      <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 10 }).map((_, index) => (
          <div key={index}>
            <div className="bg-muted aspect-2/3 w-full animate-pulse rounded-md" />
            <div className="bg-muted mt-3 h-4 w-4/5 animate-pulse rounded" />
            <div className="bg-muted mt-2 h-3 w-1/2 animate-pulse rounded" />
          </div>
        ))}
      </div>
    </main>
  );
}
