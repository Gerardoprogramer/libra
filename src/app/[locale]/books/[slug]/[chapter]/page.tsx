import type { Metadata } from "next";

import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ReaderView } from "@/components/reader/ReaderView";

import { getChapterBySlug, type ContentLocale } from "@/db/queries/books";
import { createLocalizedMetadata } from "@/lib/seo-metadata";

interface ReaderPageProps {
  params: Promise<{
    locale: string;
    slug: string;
    chapter: string;
  }>;
}

function getContentLocale(locale: string): ContentLocale {
  return locale === "en" ? "en" : "es";
}

export async function generateMetadata({ params }: ReaderPageProps): Promise<Metadata> {
  const { locale, slug, chapter } = await params;
  const contentLocale = getContentLocale(locale);

  const [result, t] = await Promise.all([
    getChapterBySlug(slug, chapter, contentLocale),
    getTranslations({
      locale: contentLocale,
      namespace: "reader",
    }),
  ]);

  if (!result) {
    return createLocalizedMetadata({
      locale: contentLocale,
      pathname: `/books/${encodeURIComponent(slug)}/${encodeURIComponent(chapter)}`,
      title: t("chapterNotFoundTitle"),
      robots: {
        index: false,
        follow: true,
      },
    });
  }

  const authors = result.book.authors.map((author) => author.name).join(", ");

  return createLocalizedMetadata({
    locale: contentLocale,
    pathname: `/books/${encodeURIComponent(slug)}/${encodeURIComponent(chapter)}`,
    title: `${result.chapter.title} — ${result.book.edition.title}`,
    description: authors
      ? t("chapterMetadataDescription", {
          chapter: result.chapter.title,
          book: result.book.edition.title,
          authors,
        })
      : undefined,
    images: result.book.edition.coverUrl
      ? [{ url: result.book.edition.coverUrl, alt: result.book.edition.title }]
      : undefined,
    alternateLocales: false,
  });
}

export default async function ReaderPage({ params }: ReaderPageProps) {
  const { locale, slug, chapter } = await params;

  const result = await getChapterBySlug(slug, chapter, getContentLocale(locale));

  if (!result) {
    notFound();
  }

  const { book, chapter: currentChapter, previous, next, chapterIndex } = result;

  const paragraphs = currentChapter.content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <ReaderView
      bookSlug={book.slug}
      bookTitle={book.edition.title}
      author={book.authors.map((author) => author.name).join(", ")}
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
  );
}
