import { BookCard } from "@/components/books/BookCard";
import { Header } from "@/components/layout/Header";

import { trendingBooks } from "@/data/books";

export default function Home() {
  return (
    <>
      <Header />

      <main>
        <section className="border-b">
          <div className="mx-auto max-w-7xl px-6 py-20 md:py-28">
            <div className="max-w-3xl">
              <p className="mb-5 text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
                A library without walls
              </p>

              <h1 className="font-serif text-5xl leading-[1.05] tracking-tight md:text-7xl">
                Great stories
                <br />
                never get old.
              </h1>

              <p className="mt-7 max-w-xl text-lg leading-8 text-muted-foreground">
                Discover timeless books, beautifully presented and free to
                read.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 py-14">
          <div className="mb-8 flex items-end justify-between">
            <div>
              <p className="mb-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Discover
              </p>

              <h2 className="font-serif text-3xl tracking-tight">
                Trending this week
              </h2>
            </div>

            <a
              href="/books"
              className="text-sm text-muted-foreground transition hover:text-foreground"
            >
              View all →
            </a>
          </div>

          <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-5">
            {trendingBooks.map((book) => (
              <BookCard
                key={book.id}
                book={book}
              />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}