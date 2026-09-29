import { getLocale, getTranslations } from "next-intl/server";

import { BookCard } from "@/components/books/BookCard";
import { getBooks, type ContentLocale } from "@/db/queries/books";
import { Link } from "@/i18n/navigation";

export default async function Home() {
  const t = await getTranslations("home");

  const locale = (await getLocale()) as ContentLocale;

  const books = await getBooks(locale);

  return (
    <main>
      <section className="border-b">
        <div className="mx-auto max-w-7xl px-6 py-20 md:py-28">
          <div className="max-w-3xl">
            <p className="text-muted-foreground mb-5 text-xs font-medium tracking-[0.25em] uppercase">{t("eyebrow")}</p>

            <h1 className="font-serif text-5xl leading-[1.05] tracking-tight md:text-7xl">
              {t("titleFirst")}
              <br />
              {t("titleSecond")}
            </h1>

            <p className="text-muted-foreground mt-7 max-w-xl text-lg leading-8">{t("description")}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-14">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <p className="text-muted-foreground mb-2 text-xs tracking-[0.2em] uppercase">{t("discover")}</p>

            <h2 className="font-serif text-3xl tracking-tight">{t("trending")}</h2>
          </div>

          <Link href="/books" className="text-muted-foreground hover:text-foreground text-sm transition">
            {t("viewAll")} →
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-5">
          {books.slice(0, 5).map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>
      </section>
    </main>
  );
}
