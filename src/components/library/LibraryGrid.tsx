"use client";

import { FiBookOpen } from "react-icons/fi";

import { BookCard } from "@/components/books/BookCard";
import { BookCardSkeleton } from "@/components/books/BookCardSkeleton";

import { Button } from "@/components/ui/button";

import { useLibrary } from "@/hooks/useLibrary";

import { Link } from "@/i18n/navigation";

interface LibraryBook {
  id: string;
  slug: string;
  title: string;
  author: string;
  year: number | null;
  language: string;
  coverUrl: string | null;
}

interface LibraryGridProps {
  books: LibraryBook[];

  emptyTitle: string;
  emptyDescription: string;
  browseLabel: string;
}

export function LibraryGrid({ books, emptyTitle, emptyDescription, browseLabel }: LibraryGridProps) {
  const { entries, isReady } = useLibrary();

  if (!isReady) {
    return (
      <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({
          length: 5,
        }).map((_, index) => (
          <BookCardSkeleton key={index} />
        ))}
      </div>
    );
  }

  const order = new Map(entries.map((entry, index) => [entry.bookSlug, index]));

  const savedBooks = books
    .filter((book) => order.has(book.slug))
    .sort((first, second) => (order.get(first.slug) ?? Infinity) - (order.get(second.slug) ?? Infinity));

  if (savedBooks.length === 0) {
    return (
      <div className="flex min-h-80 flex-col items-center justify-center border-y px-6 text-center">
        <div className="bg-muted flex size-12 items-center justify-center rounded-full">
          <FiBookOpen className="text-muted-foreground size-5" />
        </div>

        <h2 className="mt-5 font-serif text-2xl">{emptyTitle}</h2>

        <p className="text-muted-foreground mt-2 max-w-md text-sm leading-6">{emptyDescription}</p>

        <Button className="mt-6" asChild>
          <Link href="/books">{browseLabel}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {savedBooks.map((book, index) => (
        <BookCard key={book.id} book={book} eager={index < 4} />
      ))}
    </div>
  );
}
