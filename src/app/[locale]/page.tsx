import type { Metadata } from "next";

import { getLocale, getTranslations } from "next-intl/server";

import { FiArrowRight } from "react-icons/fi";
import { BookCard } from "@/components/books/BookCard";
import { Button } from "@/components/ui/button";
import { getBooks, type ContentLocale } from "@/db/queries/books";
import { Link } from "@/i18n/navigation";
import { ContinueReading } from "@/components/home/ContinueReading";
import { RecentlyRead } from "@/components/home/RecentlyRead";
import { createLocalizedMetadata } from "@/lib/seo-metadata";

interface HomePageProps {
  params: Promise<{
    locale: string;
  }>;
}

export async function generateMetadata({ params }: HomePageProps): Promise<Metadata> {
  const { locale: routeLocale } = await params;
  const locale: ContentLocale = routeLocale === "en" ? "en" : "es";
  const t = await getTranslations({
    locale,
    namespace: "home",
  });

  return createLocalizedMetadata({
    locale,
    pathname: "/",
    title: t("metadataTitle"),
    description: t("metadataDescription"),
  });
}

export default async function Home() {
  const locale = (await getLocale()) as ContentLocale;

  const [books, t, nav, recentlyRead, continueReading] = await Promise.all([
    getBooks(locale),
    getTranslations("home"),
    getTranslations("nav"),
    getTranslations("recentlyRead"),
    getTranslations("continueReading"),
  ]);

  const readingBooks = books.map((book) => ({
    slug: book.slug,
    title: book.title,
    author: book.author,
    coverUrl: book.coverUrl,
  }));

  return (
    <main id="main-content">
      <section className="border-b">
        <div className="mx-auto max-w-7xl px-6 py-16 md:py-24">
          <div className="max-w-3xl">
            <p className="text-muted-foreground eyebrow mb-5">{t("eyebrow")}</p>

            <h1 className="page-title lg:text-7xl">
              {t("titleFirst")}
              <br />
              {t("titleSecond")}
            </h1>

            <p className="text-muted-foreground mt-7 max-w-xl text-lg leading-8">{t("description")}</p>

            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Button size="lg" asChild>
                <Link href="/books">
                  {t("browseBooks")}
                  <FiArrowRight />
                </Link>
              </Button>

              <Link href="/categories" className="text-muted-foreground hover:text-foreground text-sm transition">
                {nav("categories")}
              </Link>

              <Link href="/authors" className="text-muted-foreground hover:text-foreground text-sm transition">
                {nav("authors")}
              </Link>

              <Link href="/library" className="text-muted-foreground hover:text-foreground text-sm transition">
                {nav("library")}
              </Link>
            </div>
          </div>
        </div>
      </section>
      {books.length > 0 && (
        <section className="mx-auto max-w-7xl px-6 py-14 md:py-16">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <p className="text-muted-foreground eyebrow mb-2">{t("discover")}</p>

              <h2 className="section-title">{t("collectionTitle")}</h2>
            </div>

            <Link href="/books" className="text-muted-foreground hover:text-foreground text-sm transition">
              {t("viewAll")} <span aria-hidden="true">→</span>
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-5">
            {books.slice(0, 5).map((book, index) => (
              <BookCard
                key={book.id}
                book={book}
                headingLevel={3}
                eager={index < 2}
                fetchPriority={index === 0 ? "high" : "auto"}
                sizes="(max-width: 639px) calc((100vw - 4.5rem) / 2), (max-width: 1023px) calc((100vw - 6rem) / 3), 230px"
              />
            ))}
          </div>
        </section>
      )}
      {/* The reading history exists only in the browser (and the cloud), so these blocks appear after hydration.
          Below the catalog they add to the end of the page instead of pushing the catalog down. */}
      <ContinueReading
        books={readingBooks}
        title={continueReading("title")}
        chapterLabel={continueReading("chapter")}
        continueLabel={continueReading("continue")}
        storageUnavailableLabel={continueReading("storageUnavailable")}
      />
      <RecentlyRead books={readingBooks} title={recentlyRead("title")} continueLabel={recentlyRead("continue")} />
    </main>
  );
}
