import type { Metadata } from "next";

import { getTranslations } from "next-intl/server";

import { notFound } from "next/navigation";

import { BookCard } from "@/components/books/BookCard";

import { getAuthorBySlug, type ContentLocale } from "@/db/queries/books";
import { createLocalizedMetadata } from "@/lib/seo-metadata";
import { JsonLd } from "@/components/seo/JsonLd";
import { getConfiguredSiteUrl } from "@/lib/site-url";

interface AuthorPageProps {
  params: Promise<{
    locale: string;
    slug: string;
  }>;
}

function getContentLocale(locale: string): ContentLocale {
  return locale === "en" ? "en" : "es";
}

export async function generateMetadata({ params }: AuthorPageProps): Promise<Metadata> {
  const { locale, slug } = await params;

  const [author, t] = await Promise.all([getAuthorBySlug(slug, getContentLocale(locale)), getTranslations("author")]);

  if (!author) {
    return createLocalizedMetadata({
      locale: getContentLocale(locale),
      pathname: `/authors/${encodeURIComponent(slug)}`,
      title: t("notFoundTitle"),
      robots: {
        index: false,
        follow: true,
      },
    });
  }

  return createLocalizedMetadata({
    locale: getContentLocale(locale),
    pathname: `/authors/${encodeURIComponent(slug)}`,
    title: `${author.name} — Libra`,
    description: t("metadataDescription", {
      count: author.books.length,
      name: author.name,
    }),
  });
}

export default async function AuthorPage({ params }: AuthorPageProps) {
  const { locale, slug } = await params;

  const [author, t] = await Promise.all([getAuthorBySlug(slug, getContentLocale(locale)), getTranslations("author")]);

  if (!author) {
    notFound();
  }

  const lifespan =
    author.birthYear !== null && author.deathYear !== null
      ? `${author.birthYear} — ${author.deathYear}`
      : author.birthYear !== null
        ? t("born", { year: author.birthYear })
        : author.deathYear !== null
          ? t("died", { year: author.deathYear })
          : null;

  const siteUrl = getConfiguredSiteUrl();

  const authorUrl = siteUrl
    ? new URL(`/${getContentLocale(locale)}/authors/${encodeURIComponent(author.slug)}`, siteUrl).href
    : null;

  const authorStructuredData =
    siteUrl && authorUrl
      ? {
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "WebPage",
              "@id": `${authorUrl}#webpage`,
              url: authorUrl,
              name: `${author.name} — Libra`,
              inLanguage: getContentLocale(locale),
              mainEntity: {
                "@id": `${authorUrl}#person`,
              },
              breadcrumb: {
                "@id": `${authorUrl}#breadcrumb`,
              },
            },
            {
              "@type": "Person",
              "@id": `${authorUrl}#person`,
              name: author.name,
              url: authorUrl,
              ...(author.birthYear !== null ? { birthDate: String(author.birthYear) } : {}),
              ...(author.deathYear !== null ? { deathDate: String(author.deathYear) } : {}),
            },
            {
              "@type": "BreadcrumbList",
              "@id": `${authorUrl}#breadcrumb`,
              itemListElement: [
                {
                  "@type": "ListItem",
                  position: 1,
                  name: getContentLocale(locale) === "es" ? "Inicio" : "Home",
                  item: new URL(`/${getContentLocale(locale)}`, siteUrl).href,
                },
                {
                  "@type": "ListItem",
                  position: 2,
                  name: getContentLocale(locale) === "es" ? "Autores" : "Authors",
                  item: new URL(`/${getContentLocale(locale)}/authors`, siteUrl).href,
                },
                {
                  "@type": "ListItem",
                  position: 3,
                  name: author.name,
                },
              ],
            },
          ],
        }
      : null;

  return (
    <>
      {authorStructuredData && <JsonLd data={authorStructuredData} />}

      <main id="main-content" className="min-h-screen">
        <section className="border-b">
          <div className="mx-auto max-w-7xl px-6 py-14 md:py-20">
            <p className="text-muted-foreground mb-3 text-xs tracking-[0.25em] uppercase">{t("eyebrow")}</p>

            <h1 className="max-w-4xl font-serif text-5xl tracking-tight md:text-6xl">{author.name}</h1>

            {lifespan && <p className="text-muted-foreground mt-4 text-lg">{lifespan}</p>}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 py-14">
          <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-muted-foreground mb-2 text-xs tracking-[0.2em] uppercase">{t("booksEyebrow")}</p>

              <h2 className="font-serif text-3xl">{t("books")}</h2>
            </div>

            <p className="text-muted-foreground text-sm">
              {t("bookCount", {
                count: author.books.length,
              })}
            </p>
          </div>

          {author.books.length > 0 ? (
            <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {author.books.map((book, index) => (
                <BookCard key={book.id} book={book} eager={index < 4} />
              ))}
            </div>
          ) : (
            <div className="border-y py-16">
              <p className="text-muted-foreground">{t("noBooks")}</p>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
