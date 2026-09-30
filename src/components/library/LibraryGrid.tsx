"use client";

import { FiBookOpen } from "react-icons/fi";

import { BookCard } from "@/components/books/BookCard";
import { LibraryButton } from "@/components/books/LibraryButton";
import { LibraryGridSkeleton } from "@/components/library/LibraryGridSkeleton";

import { Button } from "@/components/ui/button";

import { useLibrary } from "@/hooks/useLibrary";
import type { BookListItem } from "@/db/queries/books";

import { Link } from "@/i18n/navigation";

interface LibraryGridProps {
  books: BookListItem[];

  emptyTitle: string;
  emptyDescription: string;
  browseLabel: string;
  addLabel: string;
  removeLabel: string;
  errorLabel: string;
  unavailableTitle: string;
}

export function LibraryGrid({
  books,
  emptyTitle,
  emptyDescription,
  browseLabel,
  addLabel,
  removeLabel,
  errorLabel,
  unavailableTitle,
}: LibraryGridProps) {
  const { entries, isReady, isAvailable } = useLibrary();

  if (!isReady) {
    return <LibraryGridSkeleton />;
  }

  const booksBySlug = new Map(books.map((book) => [book.slug, book]));

  // parseLibrary orders entries by addedAt. Unavailable books stay saved locally.
  const savedBooks = entries
    .map((entry) => booksBySlug.get(entry.bookSlug))
    .filter((book): book is BookListItem => book !== undefined);

  if (savedBooks.length === 0) {
    return (
      <div className="flex min-h-80 flex-col items-center justify-center border-y px-6 text-center">
        <div className="bg-muted flex size-12 items-center justify-center rounded-full">
          <FiBookOpen aria-hidden="true" className="text-muted-foreground size-5" />
        </div>

        <h2 className="mt-5 font-serif text-2xl">{isAvailable ? emptyTitle : unavailableTitle}</h2>

        <p className="text-muted-foreground mt-2 max-w-md text-sm leading-6">
          {isAvailable ? emptyDescription : errorLabel}
        </p>

        <Button className="mt-6" asChild>
          <Link href="/books">{browseLabel}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {savedBooks.map((book, index) => (
        <div key={book.id} className="space-y-4">
          <BookCard book={book} eager={index < 4} />
          <LibraryButton
            bookSlug={book.slug}
            bookTitle={book.title}
            addLabel={addLabel}
            removeLabel={removeLabel}
            errorLabel={errorLabel}
            size="sm"
          />
        </div>
      ))}
    </div>
  );
}
