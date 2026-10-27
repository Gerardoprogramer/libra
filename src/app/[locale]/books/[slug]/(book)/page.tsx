import type { Metadata } from "next";
import Image from "next/image";

import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { FiBookOpen } from "react-icons/fi";

import { Badge } from "@/components/ui/badge";
import { BookReadingAction } from "@/components/books/BookReadingAction";
import { EditionDetails } from "@/components/books/EditionDetails";
import { WorkDescription } from "@/components/books/WorkDescription";

import { getBookBySlug, getBookContentLocales, getSitemapContent, type ContentLocale } from "@/db/queries/books";
import { LibraryButton } from "@/components/books/LibraryButton";
import { isSlug } from "@/lib/catalog-filters";
import { createLocalizedMetadata } from "@/lib/seo-metadata";
import { JsonLd } from "@/components/seo/JsonLd";
import { getAbsolutePublicImageUrl, getConfiguredSiteUrl } from "@/lib/site-url";
import { getBookSocialImage } from "@/lib/social-metadata";
import { getWorkDescription, summarizeDescription } from "@/lib/work-descriptions";

import { Link } from "@/i18n/navigation";
import { BookShareButton } from "@/components/books/BookShareButton";

interface BookPageProps {
  params: Promise<{
    locale: string;
    slug: string;
  }>;
}

const coverStyles = [
  "from-slate-800 to-emerald-950",
  "from-red-950 to-zinc-950",
  "from-amber-900 to-stone-950",
  "from-rose-900 to-stone-950",
  "from-sky-950 to-slate-950",
];

function getCoverStyle(slug: string) {
  const value = Array.from(slug).reduce((total, character) => total + character.charCodeAt(0), 0);

  return coverStyles[value % coverStyles.length];
}

function getInterfaceLocale(locale: string): ContentLocale {
  return locale === "en" ? "en" : "es";
}

function getLanguageCode(language: string) {
  return language.toLowerCase().split("-")[0];
}

export async function generateStaticParams() {
  const { books } = await getSitemapContent();

  return books.map(({ slug }) => ({
    slug,
  }));
}

export async function generateMetadata({ params }: BookPageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const interfaceLocale = getInterfaceLocale(locale);

  // A value that cannot name a stored book never reaches the database or becomes its own cache entry.
  const validSlug = isSlug(slug);

  const [book, t, contentLocales] = await Promise.all([
    validSlug ? getBookBySlug(slug, interfaceLocale) : null,
    getTranslations({
      locale: interfaceLocale,
      namespace: "book",
    }),
    validSlug ? getBookContentLocales(slug) : [],
  ]);

  if (!book) {
    // Do not advertise book metadata for a missing or unpublished edition.
    // The page raises notFound(); here the 404 only gets its title and noindex, as the author and chapter pages do.
    return createLocalizedMetadata({
      locale: interfaceLocale,
      pathname: `/books/${encodeURIComponent(slug)}`,
      title: t("notFoundTitle"),
      robots: {
        index: false,
        follow: true,
      },
      alternateLocales: false,
    });
  }

  const authors = book.authors.map((author) => author.name).join(", ");

  const contentLanguage = getLanguageCode(book.edition.language);

  const isContentLocaleMatch = contentLanguage === interfaceLocale;
  const siteUrl = getConfiguredSiteUrl();
  const workDescription = getWorkDescription(book.slug, interfaceLocale);

  const metadata = createLocalizedMetadata({
    locale: interfaceLocale,
    pathname: `/books/${encodeURIComponent(slug)}`,
    title: authors ? `${book.edition.title} — ${authors}` : book.edition.title,
    // The edition's own description, then the work's published one (shortened), then the template.
    description:
      book.edition.description?.trim() ||
      (workDescription && summarizeDescription(workDescription)) ||
      t(authors ? "metadataDescription" : "metadataDescriptionWithoutAuthors", {
        title: book.edition.title,
        authors,
      }),
    robots: isContentLocaleMatch
      ? undefined
      : {
          index: false,
          follow: true,
        },
    alternateLocales: isContentLocaleMatch && contentLocales.length > 1 ? contentLocales : false,
    canonical: true,
    bookAuthors: siteUrl
      ? book.authors.map(
          (author) => new URL(`/${interfaceLocale}/authors/${encodeURIComponent(author.slug)}`, siteUrl).href,
        )
      : [],
    images: getBookSocialImage(interfaceLocale, book.slug, book.edition.title, authors),
  });

  return { ...metadata, authors: book.authors.map((author) => ({ name: author.name })) };
}

export default async function BookPage({ params }: BookPageProps) {
  const { locale, slug } = await params;
  const interfaceLocale = getInterfaceLocale(locale);

  const [book, t, readerTranslations] = await Promise.all([
    isSlug(slug) ? getBookBySlug(slug, interfaceLocale) : null,
    getTranslations("book"),
    getTranslations("reader"),
  ]);

  if (!book) {
    notFound();
  }

  const authors = book.authors.map((author) => author.name).join(", ");

  const siteUrl = getConfiguredSiteUrl();

  const bookUrl = siteUrl ? new URL(`/${interfaceLocale}/books/${encodeURIComponent(book.slug)}`, siteUrl).href : null;

  const imageUrl = book.edition.coverUrl ? getAbsolutePublicImageUrl(book.edition.coverUrl) : null;

  const workDescription = getWorkDescription(book.slug, interfaceLocale);
  // Structured data repeats a description shown on the page, in full: the edition's, or else the work's. The work's
  // is written in the interface language, so it is only used when that is the edition's (the Book's inLanguage).
  const isContentLocaleMatch = getLanguageCode(book.edition.language) === interfaceLocale;
  const structuredDescription = book.edition.description?.trim() || (isContentLocaleMatch ? workDescription : null);

  const authorEntities = siteUrl
    ? book.authors.map((author) => {
        const authorUrl = new URL(`/${interfaceLocale}/authors/${encodeURIComponent(author.slug)}`, siteUrl).href;

        return {
          "@type": "Person",
          "@id": `${authorUrl}#person`,
          name: author.name,
          url: authorUrl,
        };
      })
    : [];

  const bookStructuredData =
    siteUrl && bookUrl
      ? {
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "WebPage",
              "@id": `${bookUrl}#webpage`,
              url: bookUrl,
              name: book.edition.title,
              inLanguage: interfaceLocale,
              mainEntity: {
                "@id": `${bookUrl}#book`,
              },
              breadcrumb: {
                "@id": `${bookUrl}#breadcrumb`,
              },
            },
            {
              "@type": "Book",
              "@id": `${bookUrl}#book`,
              name: book.edition.title,
              url: bookUrl,
              inLanguage: book.edition.language,
              isAccessibleForFree: true,
              author: authorEntities,
              ...(structuredDescription ? { description: structuredDescription } : {}),
              ...(imageUrl ? { image: imageUrl } : {}),
              ...(book.edition.publicationYear !== null ? { datePublished: String(book.edition.publicationYear) } : {}),
              ...(book.categories.length > 0 ? { genre: book.categories.map((category) => category.name) } : {}),
              ...(book.edition.translator?.trim()
                ? {
                    translator: {
                      "@type": "Person",
                      name: book.edition.translator.trim(),
                    },
                  }
                : {}),
              ...(book.edition.sourceUrl ? { sameAs: book.edition.sourceUrl } : {}),
            },
            {
              "@type": "BreadcrumbList",
              "@id": `${bookUrl}#breadcrumb`,
              itemListElement: [
                {
                  "@type": "ListItem",
                  position: 1,
                  name: t("breadcrumbHome"),
                  item: new URL(`/${interfaceLocale}`, siteUrl).href,
                },
                {
                  "@type": "ListItem",
                  position: 2,
                  name: t("breadcrumbBooks"),
                  item: new URL(`/${interfaceLocale}/books`, siteUrl).href,
                },
                {
                  "@type": "ListItem",
                  position: 3,
                  name: book.edition.title,
                  item: bookUrl,
                },
              ],
            },
          ],
        }
      : null;

  const firstChapter = book.chapters[0];

  const coverStyle = getCoverStyle(book.slug);

  const renderChapters = () =>
    book.chapters.map((chapter) => (
      <Link
        key={chapter.id}
        href={`/books/${book.slug}/${chapter.slug}`}
        className="group flex min-w-0 items-center gap-4 py-3"
      >
        <span className="text-muted-foreground w-8 shrink-0 text-sm tabular-nums">
          {String(chapter.number).padStart(2, "0")}
        </span>

        <span className="font-serif leading-snug transition-transform group-hover:translate-x-1">{chapter.title}</span>

        <FiBookOpen
          aria-hidden="true"
          className="text-muted-foreground group-hover:text-foreground ml-auto size-4 shrink-0 transition"
        />
      </Link>
    ));

  return (
    <>
      {bookStructuredData && <JsonLd data={bookStructuredData} />}

      <main id="main-content" className="min-h-screen">
        <nav aria-label={t("breadcrumbs")} className="mx-auto max-w-7xl px-6 pt-6 text-sm">
          <ol className="text-muted-foreground flex flex-wrap items-center gap-2">
            <li>
              <Link href="/" className="hover:underline">
                {t("breadcrumbHome")}
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link href="/books" className="hover:underline">
                {t("breadcrumbBooks")}
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="text-foreground">
              {book.edition.title}
            </li>
          </ol>
        </nav>
        <section className="border-b">
          <div className="mx-auto grid max-w-7xl gap-12 px-6 py-14 md:grid-cols-[280px_1fr] md:py-20">
            <div>
              <div
                className={`relative mx-auto aspect-2/3 w-full max-w-70 overflow-hidden rounded-lg bg-linear-to-br ${coverStyle} shadow-2xl`}
              >
                {book.edition.coverUrl && (
                  <Image
                    src={book.edition.coverUrl}
                    alt={t("coverAlt", { title: book.edition.title })}
                    fill
                    loading="eager"
                    fetchPriority="high"
                    sizes="(max-width: 328px) calc(100vw - 48px), 280px"
                    quality={50}
                    className="object-cover"
                  />
                )}

                {!book.edition.coverUrl && (
                  <>
                    <div className="absolute inset-0 bg-black/10" />

                    <div className="absolute inset-x-8 top-10 text-center">
                      <p className="text-[10px] tracking-[0.3em] text-white/60 uppercase">{book.edition.language}</p>
                    </div>

                    <div className="absolute inset-x-7 top-1/2 -translate-y-1/2 text-center">
                      <p className="font-serif text-3xl leading-tight text-white">{book.edition.title}</p>

                      <div className="mx-auto my-5 h-px w-12 bg-white/40" />

                      <p className="text-sm text-white/70">{authors || t("anonymousAuthor")}</p>
                    </div>

                    {(book.edition.publicationYear ?? book.originalPublicationYear) && (
                      <p className="absolute inset-x-0 bottom-8 text-center text-xs tracking-widest text-white/40">
                        {book.edition.publicationYear ?? book.originalPublicationYear}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-col justify-center">
              {book.categories.length > 0 && (
                <div className="mb-5 flex flex-wrap items-center gap-2">
                  {book.categories.map((category) => (
                    <Badge key={category.id} variant="secondary" asChild>
                      <Link href={`/books?category=${category.slug}`}>{category.name}</Link>
                    </Badge>
                  ))}
                </div>
              )}

              <h1
                lang={getLanguageCode(book.edition.language)}
                className="max-w-3xl font-serif text-4xl leading-tight tracking-tight sm:text-5xl md:text-6xl"
              >
                {book.edition.title}
              </h1>

              <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-1 text-lg">
                {book.authors.length > 0 ? (
                  <>
                    <span>{t("by")}</span>

                    {book.authors.map((author, index) => (
                      <span key={author.id}>
                        <Link href={`/authors/${author.slug}`} className="text-foreground transition hover:underline">
                          {author.name}
                        </Link>

                        {index < book.authors.length - 1 && ","}
                      </span>
                    ))}
                  </>
                ) : (
                  // An anonymous work: a label, not an author page.
                  <span className="text-foreground">{t("anonymousAuthor")}</span>
                )}
              </div>

              {book.originalPublicationYear !== null && (
                <p className="text-muted-foreground mt-2 text-sm">
                  {t("originalPublicationYear", { year: book.originalPublicationYear })}
                </p>
              )}

              <EditionDetails edition={book.edition} chapterCount={book.chapters.length} />

              {book.edition.description && (
                <p
                  lang={getLanguageCode(book.edition.language)}
                  className="text-muted-foreground mt-8 max-w-2xl text-base leading-8"
                >
                  {book.edition.description}
                </p>
              )}

              <div className="mt-9 flex flex-wrap items-start gap-3">
                {firstChapter && (
                  <BookReadingAction
                    bookSlug={book.slug}
                    editionId={book.edition.id}
                    chapterSlugs={book.chapters.map((chapter) => chapter.slug)}
                    firstChapterSlug={firstChapter.slug}
                    startLabel={t("startReading")}
                    continueLabel={t("continueReading")}
                    readAgainLabel={t("readAgain")}
                    progressLabel={readerTranslations("progress", { progress: "{progress}" })}
                  />
                )}

                <LibraryButton
                  bookSlug={book.slug}
                  addLabel={t("addToLibrary")}
                  removeLabel={t("removeFromLibrary")}
                  errorLabel={t("libraryError")}
                />

                <BookShareButton
                  title={authors ? `${book.edition.title} — ${authors}` : book.edition.title}
                  text={
                    authors
                      ? t("shareText", {
                          title: book.edition.title,
                          authors,
                        })
                      : t("shareTextWithoutAuthor", {
                          title: book.edition.title,
                        })
                  }
                  url={bookUrl ?? undefined}
                  label={t("share")}
                  copiedLabel={t("shareCopied")}
                  errorLabel={t("shareError")}
                />
              </div>
            </div>
          </div>
        </section>

        <WorkDescription description={workDescription} lang={interfaceLocale} />

        <section className="mx-auto max-w-4xl px-6 py-14">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-muted-foreground mb-2 text-xs tracking-[0.2em] uppercase">{t("contents")}</p>

              <h2 className="font-serif text-3xl">{t("chapterList")}</h2>
            </div>

            <p className="text-muted-foreground text-sm">{t("chapters", { count: book.chapters.length })}</p>
          </div>

          {book.chapters.length > 0 ? (
            <div className="divide-y">
              {book.chapters.length > 20 && (
                <details className="group">
                  <summary className="text-muted-foreground hover:text-foreground cursor-pointer py-4 text-sm transition">
                    {t("showAllChapters", {
                      count: book.chapters.length,
                    })}
                  </summary>
                  <div className="grid gap-x-8 md:grid-cols-2">{renderChapters()}</div>
                </details>
              )}

              {book.chapters.length <= 20 && <div className="grid gap-x-8 md:grid-cols-2">{renderChapters()}</div>}
            </div>
          ) : (
            <p className="text-muted-foreground border-y py-8">{t("noChaptersAvailable")}</p>
          )}
        </section>
      </main>
    </>
  );
}
