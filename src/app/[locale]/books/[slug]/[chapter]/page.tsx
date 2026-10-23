import type { Metadata } from "next";
import { Suspense } from "react";

import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";

import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { ReaderPending } from "@/components/reader/ReaderPending";
import { ReaderView } from "@/components/reader/ReaderView";

import {
  chapterExistsInPublicEdition,
  getChapterBySlug,
  getSitemapContent,
  type ContentLocale,
} from "@/db/queries/books";
import { isSlug, isUuid } from "@/lib/catalog-filters";
import { readingFontVariables } from "@/lib/fonts/reading";
import { createLocalizedMetadata } from "@/lib/seo-metadata";
import { JsonLd } from "@/components/seo/JsonLd";
import { getAbsolutePublicImageUrl, getConfiguredSiteUrl } from "@/lib/site-url";
import { readingProgressHref } from "@/lib/reading-progress";

interface ReaderPageProps {
  searchParams: Promise<{ edition?: string | string[] }>;
  params: Promise<{
    locale: string;
    slug: string;
    chapter: string;
  }>;
}

function getInterfaceLocale(locale: string): ContentLocale {
  return locale === "en" ? "en" : "es";
}

function getLanguageCode(language: string) {
  return language.toLowerCase().split("-")[0];
}

export async function generateMetadata({ params, searchParams }: ReaderPageProps): Promise<Metadata> {
  const { locale, slug, chapter } = await params;
  const requestedEdition = (await searchParams).edition;
  // An edition id that is not a UUID can never name an edition: do not let it become a cache key.
  const invalidEdition = requestedEdition !== undefined && !isUuid(requestedEdition);
  const editionId = isUuid(requestedEdition) ? requestedEdition : undefined;
  const interfaceLocale = getInterfaceLocale(locale);

  const [result, t] = await Promise.all([
    invalidEdition ? null : getChapterBySlug(slug, chapter, interfaceLocale, editionId),
    getTranslations({
      locale: interfaceLocale,
      namespace: "reader",
    }),
  ]);

  if (!result) {
    return createLocalizedMetadata({
      locale: interfaceLocale,
      pathname: `/books/${encodeURIComponent(slug)}/${encodeURIComponent(chapter)}`,
      title: t("chapterNotFoundTitle"),
      robots: {
        index: false,
        follow: true,
      },
      alternateLocales: false,
    });
  }

  const authors = result.book.authors.map((author) => author.name).join(", ");
  const contentLanguage = getLanguageCode(result.book.edition.language);
  const isContentLocaleMatch = contentLanguage === interfaceLocale;

  return createLocalizedMetadata({
    locale: interfaceLocale,
    pathname: `/books/${encodeURIComponent(slug)}/${encodeURIComponent(chapter)}`,
    title: `${result.chapter.title} — ${result.book.edition.title}`,
    description: authors
      ? t("chapterMetadataDescription", {
          chapter: result.chapter.title,
          book: result.book.edition.title,
          authors,
        })
      : undefined,
    robots: isContentLocaleMatch
      ? undefined
      : {
          index: false,
          follow: true,
        },
    alternateLocales: false,
    images: result.book.edition.coverUrl
      ? [{ url: result.book.edition.coverUrl, alt: result.book.edition.title }]
      : undefined,
  });
}

// With Cache Components generateStaticParams must return at least one param. One chapter per book and locale is
// prerendered; every other existing chapter renders on its first visit and is cached afterwards.
export async function generateStaticParams() {
  const { chapters } = await getSitemapContent();
  const first = new Map<string, { locale: ContentLocale; slug: string; chapter: string }>();

  for (const item of chapters) {
    const key = `${item.locale}/${item.bookSlug}`;

    if (!first.has(key)) first.set(key, { locale: item.locale, slug: item.bookSlug, chapter: item.slug });
  }

  return [...first.values()];
}

export default async function ReaderPage(props: ReaderPageProps) {
  const { slug, chapter } = await props.params;

  // A chapter that exists in no public edition is a real 404. The status has to be decided before the Suspense
  // boundary below starts streaming: afterwards it is already 200 and can only be marked noindex.
  if (!isSlug(slug) || !isSlug(chapter) || !(await chapterExistsInPublicEdition(slug, chapter))) {
    notFound();
  }

  return (
    <Suspense fallback={<ReaderPending className="mx-auto min-h-screen max-w-3xl px-6 py-12" aria-busy="true" />}>
      <ReaderContent {...props} />
    </Suspense>
  );
}

async function ReaderContent({ params, searchParams }: ReaderPageProps) {
  const { locale, slug, chapter } = await params;
  const requestedEdition = (await searchParams).edition;
  if (requestedEdition !== undefined && !isUuid(requestedEdition)) notFound();
  const interfaceLocale = getInterfaceLocale(locale);

  const [result, messages, bookT, navT] = await Promise.all([
    getChapterBySlug(slug, chapter, interfaceLocale, requestedEdition),
    getMessages(),
    getTranslations({ locale: interfaceLocale, namespace: "book" }),
    getTranslations({ locale: interfaceLocale, namespace: "nav" }),
  ]);

  if (!result) {
    notFound();
  }

  const { book, chapter: currentChapter, previous, next, chapterIndex } = result;

  const contentLanguage = getLanguageCode(book.edition.language);

  const siteUrl = getConfiguredSiteUrl();

  const chapterUrl = siteUrl
    ? new URL(
        `/${interfaceLocale}/books/${encodeURIComponent(book.slug)}/${encodeURIComponent(currentChapter.slug)}`,
        siteUrl,
      ).href
    : null;

  const bookUrl = siteUrl ? new URL(`/${interfaceLocale}/books/${encodeURIComponent(book.slug)}`, siteUrl).href : null;

  const chapterStructuredData =
    siteUrl && chapterUrl && bookUrl
      ? {
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "WebPage",
              "@id": `${chapterUrl}#webpage`,
              url: chapterUrl,
              name: `${currentChapter.title} — ${book.edition.title}`,
              inLanguage: contentLanguage,
              isPartOf: {
                "@id": `${bookUrl}#book`,
              },
              mainEntity: {
                "@id": `${chapterUrl}#chapter`,
              },
              breadcrumb: {
                "@id": `${chapterUrl}#breadcrumb`,
              },
            },
            {
              "@type": "Chapter",
              "@id": `${chapterUrl}#chapter`,
              name: currentChapter.title,
              url: chapterUrl,
              inLanguage: contentLanguage,
              position: chapterIndex + 1,
              isAccessibleForFree: true,
              isPartOf: {
                "@id": `${bookUrl}#book`,
              },
              author: book.authors.map((author) => ({
                "@type": "Person",
                name: author.name,
              })),
            },
            {
              "@type": "Book",
              "@id": `${bookUrl}#book`,
              name: book.edition.title,
              url: bookUrl,
              inLanguage: contentLanguage,
              isAccessibleForFree: true,
              author: book.authors.map((author) => ({
                "@type": "Person",
                name: author.name,
              })),
              ...(book.edition.coverUrl
                ? { image: getAbsolutePublicImageUrl(book.edition.coverUrl) ?? undefined }
                : {}),
            },
            {
              "@type": "BreadcrumbList",
              "@id": `${chapterUrl}#breadcrumb`,
              itemListElement: [
                {
                  "@type": "ListItem",
                  position: 1,
                  name: bookT("breadcrumbHome"),
                  item: new URL(`/${interfaceLocale}`, siteUrl).href,
                },
                {
                  "@type": "ListItem",
                  position: 2,
                  name: bookT("breadcrumbBooks"),
                  item: new URL(`/${interfaceLocale}/books`, siteUrl).href,
                },
                {
                  "@type": "ListItem",
                  position: 3,
                  name: book.edition.title,
                  item: bookUrl,
                },
                {
                  "@type": "ListItem",
                  position: 4,
                  name: currentChapter.title,
                },
              ],
            },
          ],
        }
      : null;

  const paragraphs = currentChapter.content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <>
      {chapterStructuredData && <JsonLd data={chapterStructuredData} />}
      <NextIntlClientProvider messages={{ reader: messages.reader, errors: messages.errors }}>
        <ReaderView
          bookSlug={book.slug}
          bookTitle={book.edition.title}
          author={book.authors.map((author) => author.name).join(", ")}
          contentLanguage={contentLanguage}
          editionId={book.edition.id}
          chapterSlug={currentChapter.slug}
          chapterId={currentChapter.id}
          chapterTitle={currentChapter.title}
          chapterNumber={currentChapter.number}
          chapterIndex={chapterIndex}
          totalChapters={book.chapters.length}
          fontVariables={readingFontVariables}
          previousHref={
            previous
              ? readingProgressHref({ bookSlug: book.slug, chapterSlug: previous.slug, editionId: book.edition.id })
              : undefined
          }
          nextHref={
            next
              ? readingProgressHref({ bookSlug: book.slug, chapterSlug: next.slug, editionId: book.edition.id })
              : undefined
          }
          languageSwitcher={
            <LanguageSwitcher
              locale={interfaceLocale}
              label={navT("language", { locale: interfaceLocale })}
              errorLabel={navT("languageLoadError")}
            />
          }
          chapters={book.chapters.map((item) => ({
            slug: item.slug,
            number: item.number,
            title: item.title,
            href: readingProgressHref({ bookSlug: book.slug, chapterSlug: item.slug, editionId: book.edition.id }),
          }))}
        >
          {paragraphs.map((paragraph, index) => (
            // Paragraphs about half a line apart (0.8em), so the gap follows the size. The typeface and the line height
            // come from the article (ReaderView, data-reader-font and data-reader-line-spacing): 1.65 by default, which
            // at the default 20px makes both whole pixels (33 and 16), like the paragraph tops the progress restores to.
            <p key={index} className="mb-[0.8em]">
              {paragraph}
            </p>
          ))}
        </ReaderView>
      </NextIntlClientProvider>
    </>
  );
}
