import type { Metadata } from "next";

import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";

import { ReaderView } from "@/components/reader/ReaderView";

import { getChapterBySlug, type ContentLocale } from "@/db/queries/books";
import { createLocalizedMetadata } from "@/lib/seo-metadata";
import { JsonLd } from "@/components/seo/JsonLd";
import { getAbsolutePublicImageUrl, getConfiguredSiteUrl } from "@/lib/site-url";

interface ReaderPageProps {
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

export async function generateMetadata({ params }: ReaderPageProps): Promise<Metadata> {
  const { locale, slug, chapter } = await params;
  const interfaceLocale = getInterfaceLocale(locale);

  const [result, t] = await Promise.all([
    getChapterBySlug(slug, chapter, interfaceLocale),
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

export default async function ReaderPage({ params }: ReaderPageProps) {
  const { locale, slug, chapter } = await params;
  const interfaceLocale = getInterfaceLocale(locale);

  const [result, messages] = await Promise.all([getChapterBySlug(slug, chapter, interfaceLocale), getMessages()]);

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
                  name: interfaceLocale === "es" ? "Inicio" : "Home",
                  item: new URL(`/${interfaceLocale}`, siteUrl).href,
                },
                {
                  "@type": "ListItem",
                  position: 2,
                  name: interfaceLocale === "es" ? "Libros" : "Books",
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
          chapterSlug={currentChapter.slug}
          chapterTitle={currentChapter.title}
          chapterNumber={currentChapter.number}
          chapterIndex={chapterIndex}
          totalChapters={book.chapters.length}
          previousHref={previous ? `/books/${book.slug}/${previous.slug}` : undefined}
          nextHref={next ? `/books/${book.slug}/${next.slug}` : undefined}
        >
          {paragraphs.map((paragraph, index) => (
            <p key={index} className="mb-7 font-serif leading-[1.95] opacity-90">
              {paragraph}
            </p>
          ))}
        </ReaderView>
      </NextIntlClientProvider>
    </>
  );
}
