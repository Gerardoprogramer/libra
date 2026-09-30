import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { LibraryGrid } from "@/components/library/LibraryGrid";
import { LibraryGridSkeleton } from "@/components/library/LibraryGridSkeleton";

import { getBooks, type ContentLocale } from "@/db/queries/books";

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
    <main className="min-h-screen">
      <section className="border-b">
        <div className="mx-auto max-w-7xl px-6 py-14 md:py-20">
          <p className="text-muted-foreground mb-3 text-xs tracking-[0.25em] uppercase">{t("eyebrow")}</p>

          <h1 className="font-serif text-5xl tracking-tight md:text-6xl">{t("title")}</h1>

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
