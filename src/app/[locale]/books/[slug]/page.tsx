import type { Metadata } from "next";

import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { FiBookOpen, FiHeart, FiShare2 } from "react-icons/fi";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import { getBookBySlug, type ContentLocale } from "@/db/queries/books";

import { Link } from "@/i18n/navigation";

interface BookPageProps {
  params: Promise<{
    locale: string;
    slug: string;
  }>;
}

const coverStyles = [
  "from-slate-800 to-emerald-950",
  "from-red-950 to-zinc-950",
  "from-amber-900 to-stone-950",
  "from-rose-900 to-stone-950",
  "from-sky-950 to-slate-950",
];

function getCoverStyle(slug: string) {
  const value = Array.from(slug).reduce((total, character) => total + character.charCodeAt(0), 0);

  return coverStyles[value % coverStyles.length];
}

function getContentLocale(locale: string): ContentLocale {
  return locale === "en" ? "en" : "es";
}

export async function generateMetadata({ params }: BookPageProps): Promise<Metadata> {
  const { locale, slug } = await params;

  const book = await getBookBySlug(slug, getContentLocale(locale));

  if (!book) {
    return {
      title: "Book not found",
    };
  }

  const authors = book.authors.map((author) => author.name).join(", ");

  return {
    title: `${book.edition.title} — ${authors}`,
    description: book.edition.description ?? `Read ${book.edition.title} on Libra.`,
  };
}

export default async function BookPage({ params }: BookPageProps) {
  const { locale, slug } = await params;

  const t = await getTranslations("book");

  const book = await getBookBySlug(slug, getContentLocale(locale));

  if (!book) {
    notFound();
  }

  const authors = book.authors.map((author) => author.name).join(", ");

  const firstChapter = book.chapters[0];

  const year = book.edition.publicationYear ?? book.originalPublicationYear;

  const coverStyle = getCoverStyle(book.slug);

  return (
    <main className="min-h-screen">
      <section className="border-b">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 py-14 md:grid-cols-[280px_1fr] md:py-20">
          <div>
            <div
              className={`relative mx-auto aspect-2/3 w-full max-w-70 overflow-hidden rounded-lg bg-linear-to-br ${coverStyle} shadow-2xl`}
              style={
                book.edition.coverUrl
                  ? {
                      backgroundImage: `url("${book.edition.coverUrl}")`,
                      backgroundPosition: "center",
                      backgroundSize: "cover",
                    }
                  : undefined
              }
            >
              {!book.edition.coverUrl && (
                <>
                  <div className="absolute inset-0 bg-black/10" />

                  <div className="absolute inset-x-8 top-10 text-center">
                    <p className="text-[10px] tracking-[0.3em] text-white/60 uppercase">{book.edition.language}</p>
                  </div>

                  <div className="absolute inset-x-7 top-1/2 -translate-y-1/2 text-center">
                    <h2 className="font-serif text-3xl leading-tight text-white">{book.edition.title}</h2>

                    <div className="mx-auto my-5 h-px w-12 bg-white/40" />

                    <p className="text-sm text-white/70">{authors}</p>
                  </div>

                  {year && (
                    <p className="absolute inset-x-0 bottom-8 text-center text-xs tracking-widest text-white/40">
                      {year}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex flex-col justify-center">
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{book.edition.language.toUpperCase()}</Badge>

              {year && <span className="text-muted-foreground text-sm">{year}</span>}

              {book.edition.translator && (
                <span className="text-muted-foreground text-sm">· {book.edition.translator}</span>
              )}
            </div>

            <h1 className="max-w-3xl font-serif text-5xl tracking-tight md:text-6xl">{book.edition.title}</h1>

            <p className="text-muted-foreground mt-3 text-lg">
              {t("by")} <span className="text-foreground">{authors}</span>
            </p>

            <div className="text-muted-foreground mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <span>
                {t("chapters", {
                  count: book.chapters.length,
                })}
              </span>

              <span>{book.edition.language.toUpperCase()}</span>

              {book.edition.sourceName && <span>{book.edition.sourceName}</span>}
            </div>

            {book.edition.description && (
              <p className="text-muted-foreground mt-8 max-w-2xl text-base leading-8">{book.edition.description}</p>
            )}

            <div className="mt-9 flex flex-wrap gap-3">
              {firstChapter && (
                <Button size="lg" asChild>
                  <Link href={`/books/${book.slug}/${firstChapter.slug}`}>
                    <FiBookOpen />
                    {t("startReading")}
                  </Link>
                </Button>
              )}

              <Button size="lg" variant="outline" disabled>
                <FiHeart />
                {t("addToLibrary")}
              </Button>

              <Button size="icon" variant="ghost" disabled>
                <FiShare2 />

                <span className="sr-only">{t("share")}</span>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-14">
        <div className="mb-7">
          <p className="text-muted-foreground mb-2 text-xs tracking-[0.2em] uppercase">{t("contents")}</p>

          <h2 className="font-serif text-3xl">{t("chapterList")}</h2>
        </div>

        {book.chapters.length > 0 ? (
          <div>
            {book.chapters.map((chapter, index) => (
              <div key={chapter.id}>
                <Link
                  href={`/books/${book.slug}/${chapter.slug}`}
                  className="group flex items-center justify-between py-5"
                >
                  <div className="flex items-center gap-5">
                    <span className="text-muted-foreground w-8 text-sm tabular-nums">
                      {String(chapter.number).padStart(2, "0")}
                    </span>

                    <span className="font-serif text-lg transition-transform group-hover:translate-x-1">
                      {chapter.title}
                    </span>
                  </div>

                  <FiBookOpen className="text-muted-foreground group-hover:text-foreground transition" />
                </Link>

                {index < book.chapters.length - 1 && <Separator />}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">No chapters available.</p>
        )}
      </section>
    </main>
  );
}
