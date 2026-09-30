import type { Metadata } from "next";

import { getTranslations } from "next-intl/server";

import { notFound } from "next/navigation";

import { BookCard } from "@/components/books/BookCard";

import { getAuthorBySlug, type ContentLocale } from "@/db/queries/books";

interface AuthorPageProps {
  params: Promise<{
    locale: string;
    slug: string;
  }>;
}

function getContentLocale(locale: string): ContentLocale {
  return locale === "en" ? "en" : "es";
}

export async function generateMetadata({ params }: AuthorPageProps): Promise<Metadata> {
  const { locale, slug } = await params;

  const author = await getAuthorBySlug(slug, getContentLocale(locale));

  if (!author) {
    return {
      title: "Author not found",
    };
  }

  const bookCount = author.books.length;

  return {
    title: `${author.name} — Libra`,

    description:
      bookCount > 0
        ? `Read ${bookCount} ${bookCount === 1 ? "book" : "books"} by ${author.name} on Libra.`
        : `Explore ${author.name} on Libra.`,
  };
}

export default async function AuthorPage({ params }: AuthorPageProps) {
  const { locale, slug } = await params;

  const t = await getTranslations("author");

  const author = await getAuthorBySlug(slug, getContentLocale(locale));

  if (!author) {
    notFound();
  }

  const lifespan =
    author.birthYear || author.deathYear ? `${author.birthYear ?? "?"} — ${author.deathYear ?? "?"}` : null;

  return (
    <main className="min-h-screen">
      <section className="border-b">
        <div className="mx-auto max-w-7xl px-6 py-14 md:py-20">
          <p className="text-muted-foreground mb-3 text-xs tracking-[0.25em] uppercase">{t("eyebrow")}</p>

          <h1 className="max-w-4xl font-serif text-5xl tracking-tight md:text-6xl">{author.name}</h1>

          {lifespan && <p className="text-muted-foreground mt-4 text-lg">{lifespan}</p>}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-14">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-muted-foreground mb-2 text-xs tracking-[0.2em] uppercase">{t("booksEyebrow")}</p>

            <h2 className="font-serif text-3xl">{t("books")}</h2>
          </div>

          <p className="text-muted-foreground text-sm">
            {t("bookCount", {
              count: author.books.length,
            })}
          </p>
        </div>

        {author.books.length > 0 ? (
          <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {author.books.map((book, index) => (
              <BookCard key={book.id} book={book} eager={index < 4} />
            ))}
          </div>
        ) : (
          <div className="border-y py-16">
            <p className="text-muted-foreground">{t("noBooks")}</p>
          </div>
        )}
      </section>
    </main>
  );
}
