import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { LibraryGrid } from "@/components/library/LibraryGrid";
import { LibraryGridSkeleton } from "@/components/library/LibraryGridSkeleton";

import { getBooks, type ContentLocale } from "@/db/queries/books";
import { createLocalizedMetadata } from "@/lib/seo-metadata";

interface LibraryPageProps {
  params: Promise<{
    locale: string;
  }>;
}

export async function generateMetadata({ params }: LibraryPageProps): Promise<Metadata> {
  const { locale: routeLocale } = await params;
  const locale: ContentLocale = routeLocale === "en" ? "en" : "es";
  const t = await getTranslations({
    locale,
    namespace: "library",
  });

  return createLocalizedMetadata({
    locale,
    pathname: "/library",
    title: t("metadataTitle"),
    description: t("description"),
    robots: {
      index: false,
      follow: false,
    },
  });
}

async function LibraryBooks({ locale }: { locale: ContentLocale }) {
  const [books, t, bookTranslations] = await Promise.all([
    getBooks(locale),
    getTranslations("library"),
    getTranslations("book"),
  ]);

  return (
    <LibraryGrid
      books={books}
      emptyTitle={t("emptyTitle")}
      emptyDescription={t("emptyDescription")}
      browseLabel={t("browseBooks")}
      unavailableTitle={t("unavailableTitle")}
      addLabel={bookTranslations("addToLibrary")}
      removeLabel={bookTranslations("removeFromLibrary")}
      errorLabel={bookTranslations("libraryError")}
    />
  );
}

export default async function LibraryPage() {
  const locale = (await getLocale()) as ContentLocale;

  const t = await getTranslations("library");

  return (
    <main id="main-content" className="min-h-screen">
      <section className="border-b">
        <div className="mx-auto max-w-7xl px-6 py-14 md:py-20">
          <p className="text-muted-foreground eyebrow mb-3">{t("eyebrow")}</p>

          <h1 className="page-title">{t("title")}</h1>

          <p className="text-muted-foreground mt-5 max-w-xl text-base leading-7">{t("description")}</p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-14">
        <Suspense fallback={<LibraryGridSkeleton />}>
          <LibraryBooks locale={locale} />
        </Suspense>
      </section>
    </main>
  );
}
