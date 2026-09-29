import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { books, getBookBySlug, getChapterBySlug } from "@/data/books";
import { ReaderView } from "@/components/reader/ReaderView";

interface ReaderPageProps {
  params: Promise<{
    slug: string;
    chapter: string;
  }>;
}

export function generateStaticParams() {
  return books.flatMap((book) =>
    book.chapters.map((chapter) => ({
      slug: book.slug,
      chapter: chapter.slug,
    })),
  );
}

export async function generateMetadata({ params }: ReaderPageProps): Promise<Metadata> {
  const { slug, chapter: chapterSlug } = await params;

  const book = getBookBySlug(slug);

  if (!book) {
    return {
      title: "Chapter not found",
    };
  }

  const chapter = getChapterBySlug(book, chapterSlug);

  if (!chapter) {
    return {
      title: "Chapter not found",
    };
  }

  return {
    title: `${chapter.title} — ${book.title}`,
    description: `Read ${chapter.title} of ${book.title} by ${book.author}.`,
  };
}

export default async function ReaderPage({ params }: ReaderPageProps) {
  const { slug, chapter: chapterSlug } = await params;

  const book = getBookBySlug(slug);

  if (!book) {
    notFound();
  }

  const chapter = getChapterBySlug(book, chapterSlug);

  if (!chapter) {
    notFound();
  }

  const chapterIndex = book.chapters.findIndex((item) => item.slug === chapter.slug);

  const previousChapter = chapterIndex > 0 ? book.chapters[chapterIndex - 1] : undefined;

  const nextChapter = chapterIndex < book.chapters.length - 1 ? book.chapters[chapterIndex + 1] : undefined;

  return (
    <ReaderView
      bookSlug={book.slug}
      bookTitle={book.title}
      author={book.author}
      chapterSlug={chapter.slug}
      chapterTitle={chapter.title}
      chapterNumber={chapter.number}
      totalChapters={book.chapters.length}
      paragraphs={chapter.content}
      previousHref={previousChapter ? `/books/${book.slug}/${previousChapter.slug}` : undefined}
      nextHref={nextChapter ? `/books/${book.slug}/${nextChapter.slug}` : undefined}
    />
  );
}
