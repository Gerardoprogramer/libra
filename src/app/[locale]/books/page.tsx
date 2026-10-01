import { Suspense } from "react";
import type { Metadata } from "next";

import { getLocale, getTranslations } from "next-intl/server";
import { FiSearch } from "react-icons/fi";

import { BookCard } from "@/components/books/BookCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { getBooks, getCategories, type ContentLocale } from "@/db/queries/books";

import { Link } from "@/i18n/navigation";
import { createLocalizedMetadata } from "@/lib/seo-metadata";

interface BooksPageProps {
  params: Promise<{
    locale: string;
  }>;
}

interface BooksContentProps {
  searchParams: Promise<{
    q?: string | string[];
    category?: string | string[];
  }>;
}

export async function generateMetadata({ params }: BooksPageProps): Promise<Metadata> {
  const { locale: routeLocale } = await params;
  const locale: ContentLocale = routeLocale === "en" ? "en" : "es";
  const t = await getTranslations({
    locale,
    namespace: "catalog",
  });

  return createLocalizedMetadata({
    locale,
    pathname: "/books",
    title: t("booksMetadataTitle"),
    description: t("booksMetadataDescription"),
  });
}

export default function BooksPage({ searchParams }: BooksContentProps) {
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

  const query = (typeof params.q === "string" ? params.q : "").trim();
  const selectedCategory = (typeof params.category === "string" ? params.category : "").trim();

  const [books, categories] = await Promise.all([
    getBooks(locale, {
      query,
      category: selectedCategory,
    }),
    getCategories(locale),
  ]);

  const hasFilters = Boolean(query || selectedCategory);

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-14 md:py-20">
      <header className="max-w-3xl">
        <p className="text-muted-foreground mb-3 text-xs tracking-[0.25em] uppercase">{t("eyebrow")}</p>

        <h1 className="font-serif text-5xl tracking-tight md:text-6xl">{t("title")}</h1>

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
          className="border-input bg-background h-9 rounded-md border px-3 text-sm outline-none"
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
            count: books.length,
          })}
        </p>
      </div>

      {books.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {books.map((book, index) => (
            <BookCard key={book.id} book={book} eager={index < 4} />
          ))}
        </div>
      ) : (
        <div className="flex min-h-72 items-center justify-center border-y">
          <p className="text-muted-foreground">{t("noResults")}</p>
        </div>
      )}
    </main>
  );
}

function BooksPageFallback() {
  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-14 md:py-20">
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
