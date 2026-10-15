import type { Metadata } from "next";

import { getTranslations } from "next-intl/server";

import { getAuthors } from "@/db/queries/books";

import { Link } from "@/i18n/navigation";
import { createLocalizedMetadata } from "@/lib/seo-metadata";

interface AuthorsPageProps {
  params: Promise<{
    locale: string;
  }>;
}

export async function generateMetadata({ params }: AuthorsPageProps): Promise<Metadata> {
  const { locale: routeLocale } = await params;
  const locale = routeLocale === "en" ? "en" : "es";
  const t = await getTranslations({
    locale,
    namespace: "author",
  });

  return createLocalizedMetadata({
    locale,
    pathname: "/authors",
    title: t("listingMetadataTitle"),
    description: t("listingDescription"),
  });
}

export default async function AuthorsPage() {
  const [authors, t] = await Promise.all([getAuthors(), getTranslations("author")]);

  return (
    <main id="main-content" className="mx-auto min-h-screen max-w-7xl px-6 py-14 md:py-20">
      <header className="max-w-3xl">
        <p className="text-muted-foreground mb-3 text-xs tracking-[0.25em] uppercase">{t("listingEyebrow")}</p>

        <h1 className="font-serif text-5xl tracking-tight md:text-6xl">{t("listingTitle")}</h1>

        <p className="text-muted-foreground mt-5 max-w-2xl text-lg leading-8">{t("listingDescription")}</p>
      </header>

      {authors.length > 0 ? (
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {authors.map((author) => {
            const lifespan =
              author.birthYear !== null && author.deathYear !== null
                ? `${author.birthYear} — ${author.deathYear}`
                : author.birthYear !== null
                  ? t("born", { year: author.birthYear })
                  : author.deathYear !== null
                    ? t("died", { year: author.deathYear })
                    : null;

            return (
              <Link
                key={author.id}
                href={`/authors/${author.slug}`}
                className="group hover:bg-muted/40 border p-7 transition"
              >
                <h2 className="font-serif text-2xl">{author.name}</h2>

                {lifespan && <p className="text-muted-foreground mt-2 text-sm">{lifespan}</p>}

                <p className="text-muted-foreground mt-8 text-sm">
                  {t("authorBookCount", {
                    count: author.bookCount,
                  })}
                </p>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="mt-12 flex min-h-72 items-center justify-center border-y">
          <p className="text-muted-foreground">{t("noAuthors")}</p>
        </div>
      )}
    </main>
  );
}
