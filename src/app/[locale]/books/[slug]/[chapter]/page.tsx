import type { Metadata } from "next";

import { notFound } from "next/navigation";

import { ReaderView } from "@/components/reader/ReaderView";

import { getChapterBySlug, type ContentLocale } from "@/db/queries/books";

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

  const result = await getChapterBySlug(slug, chapter, getContentLocale(locale));

  if (!result) {
    return {
      title: "Chapter not found",
    };
  }

  const authors = result.book.authors.map((author) => author.name).join(", ");

  return {
    title: `${result.chapter.title} — ${result.book.edition.title}`,
    description: `Read ${result.chapter.title} from ${result.book.edition.title} by ${authors} on Libra.`,
  };
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
      paragraphs={paragraphs}
      previousHref={previous ? `/books/${book.slug}/${previous.slug}` : undefined}
      nextHref={next ? `/books/${book.slug}/${next.slug}` : undefined}
    />
  );
}
