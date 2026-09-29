import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FiArrowLeft, FiChevronLeft, FiChevronRight } from "react-icons/fi";

import { Button } from "@/components/ui/button";
import { books, getBookBySlug, getChapterBySlug } from "@/data/books";

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
    <main className="min-h-screen">
      <div className="mx-auto max-w-3xl px-6 py-12 md:py-20">
        <Link
          href={`/books/${book.slug}`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm transition"
        >
          <FiArrowLeft />
          {book.title}
        </Link>

        <header className="py-14 text-center">
          <p className="text-muted-foreground mb-3 text-xs tracking-[0.25em] uppercase">{book.title}</p>

          <h1 className="font-serif text-4xl tracking-tight md:text-5xl">{chapter.title}</h1>

          <p className="text-muted-foreground mt-4 text-sm">{book.author}</p>
        </header>

        <article className="mx-auto max-w-170">
          {chapter.content.map((paragraph, index) => (
            <p key={index} className="text-foreground/90 mb-7 font-serif text-[1.2rem] leading-[1.95] md:text-[1.3rem]">
              {paragraph}
            </p>
          ))}
        </article>

        <div className="mt-20 border-t pt-8">
          <div className="flex items-center justify-between gap-4">
            {previousChapter ? (
              <Button variant="outline" asChild>
                <Link href={`/books/${book.slug}/${previousChapter.slug}`}>
                  <FiChevronLeft />
                  Previous
                </Link>
              </Button>
            ) : (
              <div />
            )}

            <span className="text-muted-foreground text-xs">
              {chapterIndex + 1} / {book.chapters.length}
            </span>

            {nextChapter ? (
              <Button asChild>
                <Link href={`/books/${book.slug}/${nextChapter.slug}`}>
                  Next
                  <FiChevronRight />
                </Link>
              </Button>
            ) : (
              <Button variant="outline" asChild>
                <Link href={`/books/${book.slug}`}>Finish</Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
