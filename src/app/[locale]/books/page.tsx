import { getLocale } from "next-intl/server";

import { BookCard } from "@/components/books/BookCard";
import { getBooks, type ContentLocale } from "@/db/queries/books";

export default async function BooksPage() {
  const locale = (await getLocale()) as ContentLocale;

  const books = await getBooks(locale);

  return (
    <main className="mx-auto max-w-7xl px-6 py-14">
      <header className="mb-12 max-w-2xl">
        <p className="text-muted-foreground mb-3 text-xs tracking-[0.2em] uppercase">Libra</p>

        <h1 className="font-serif text-4xl tracking-tight md:text-5xl">Books</h1>

        <p className="text-muted-foreground mt-4 leading-7">Explore timeless books available to read on Libra.</p>
      </header>

      <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {books.map((book) => (
          <BookCard key={book.id} book={book} />
        ))}
      </div>
    </main>
  );
}
