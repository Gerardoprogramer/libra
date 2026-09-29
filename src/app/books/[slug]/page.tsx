import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FiBookOpen, FiHeart, FiShare2, FiStar } from "react-icons/fi";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import { books, getBookBySlug } from "@/data/books";

interface BookPageProps {
  params: Promise<{
    slug: string;
  }>;
}

export function generateStaticParams() {
  return books.map((book) => ({
    slug: book.slug,
  }));
}

export async function generateMetadata({ params }: BookPageProps): Promise<Metadata> {
  const { slug } = await params;
  const book = getBookBySlug(slug);

  if (!book) {
    return {
      title: "Book not found",
    };
  }

  return {
    title: `${book.title} by ${book.author}`,
    description: book.description,
  };
}

export default async function BookPage({ params }: BookPageProps) {
  const { slug } = await params;

  const book = getBookBySlug(slug);

  if (!book) {
    notFound();
  }

  const firstChapter = book.chapters[0];

  return (
    <main className="min-h-screen">
      <section className="border-b">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 py-14 md:grid-cols-[280px_1fr] md:py-20">
          <div>
            <div
              className={`relative mx-auto aspect-2/3 w-full max-w-70 overflow-hidden rounded-lg bg-linear-to-br ${book.cover} shadow-2xl`}
            >
              <div className="absolute inset-0 bg-black/10" />

              <div className="absolute inset-x-8 top-10 text-center">
                <p className="text-[10px] tracking-[0.3em] text-white/60 uppercase">{book.category}</p>
              </div>

              <div className="absolute inset-x-7 top-1/2 -translate-y-1/2 text-center">
                <h2 className="font-serif text-3xl leading-tight text-white">{book.title}</h2>

                <div className="mx-auto my-5 h-px w-12 bg-white/40" />

                <p className="text-sm text-white/70">{book.author}</p>
              </div>

              <p className="absolute inset-x-0 bottom-8 text-center text-xs tracking-widest text-white/40">
                {book.year}
              </p>
            </div>
          </div>

          <div className="flex flex-col justify-center">
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{book.category}</Badge>

              <span className="text-muted-foreground text-sm">{book.year}</span>
            </div>

            <h1 className="max-w-3xl font-serif text-5xl tracking-tight md:text-6xl">{book.title}</h1>

            <p className="text-muted-foreground mt-3 text-lg">
              by <span className="text-foreground">{book.author}</span>
            </p>

            <div className="text-muted-foreground mt-6 flex items-center gap-5 text-sm">
              <span className="flex items-center gap-1.5">
                <FiStar />
                {book.rating}
              </span>

              <span>{book.language}</span>

              <span>{book.chapters.length} chapters</span>
            </div>

            <p className="text-muted-foreground mt-8 max-w-2xl text-base leading-8">{book.description}</p>

            <div className="mt-9 flex flex-wrap gap-3">
              {firstChapter && (
                <Button size="lg" asChild>
                  <Link href={`/books/${book.slug}/${firstChapter.slug}`}>
                    <FiBookOpen />
                    Start reading
                  </Link>
                </Button>
              )}

              <Button size="lg" variant="outline">
                <FiHeart />
                Add to library
              </Button>

              <Button size="icon" variant="ghost">
                <FiShare2 />
                <span className="sr-only">Share book</span>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-14">
        <div className="mb-7">
          <p className="text-muted-foreground mb-2 text-xs tracking-[0.2em] uppercase">Contents</p>

          <h2 className="font-serif text-3xl">Chapters</h2>
        </div>

        <div>
          {book.chapters.map((chapter, index) => (
            <div key={chapter.slug}>
              <Link
                href={`/books/${book.slug}/${chapter.slug}`}
                className="group flex items-center justify-between py-5"
              >
                <div className="flex items-center gap-5">
                  <span className="text-muted-foreground w-8 text-sm tabular-nums">
                    {String(chapter.number).padStart(2, "0")}
                  </span>

                  <span className="font-serif text-lg transition group-hover:translate-x-1">{chapter.title}</span>
                </div>

                <FiBookOpen className="text-muted-foreground group-hover:text-foreground transition" />
              </Link>

              {index < book.chapters.length - 1 && <Separator />}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
