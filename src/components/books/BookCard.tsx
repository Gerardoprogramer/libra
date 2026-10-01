import Image from "next/image";

import { Badge } from "@/components/ui/badge";
import type { BookCategory, BookListItem } from "@/db/queries/books";
import { Link } from "@/i18n/navigation";

interface BookCardProps {
  book: BookListItem;
  eager?: boolean;
}

const coverStyles = [
  "from-slate-800 to-emerald-950",
  "from-red-950 to-zinc-950",
  "from-amber-900 to-stone-950",
  "from-rose-900 to-stone-950",
  "from-sky-950 to-slate-950",
];

function getVisibleCategories(categories: BookCategory[]) {
  const visibleCategories = categories.slice(0, 3);
  const classicLiterature = categories.find((category) => category.slug === "classic-literature");

  if (classicLiterature && !visibleCategories.some((category) => category.id === classicLiterature.id)) {
    visibleCategories[2] = classicLiterature;
  }

  return visibleCategories;
}

function getCoverStyle(slug: string) {
  const value = Array.from(slug).reduce((total, character) => total + character.charCodeAt(0), 0);

  return coverStyles[value % coverStyles.length];
}

export function BookCard({ book, eager = false }: BookCardProps) {
  const coverStyle = getCoverStyle(book.slug);
  const visibleCategories = getVisibleCategories(book.categories);

  return (
    <article>
      <Link href={`/books/${book.slug}`} className="group block">
        <div
          className={`relative aspect-2/3 overflow-hidden rounded-lg bg-linear-to-br ${coverStyle} shadow-lg transition duration-300 group-hover:-translate-y-1 group-hover:shadow-xl`}
        >
          {book.coverUrl ? (
            <Image
              src={book.coverUrl}
              alt={`Cover of ${book.title}`}
              fill
              loading={eager ? "eager" : "lazy"}
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
              className="object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col justify-between p-5 text-white">
              <span className="text-xs font-medium tracking-[0.2em] text-white/60 uppercase">{book.language}</span>

              <div>
                <h3 className="font-serif text-xl leading-tight">{book.title}</h3>

                <p className="mt-2 text-sm text-white/65">{book.author}</p>
              </div>
            </div>
          )}
        </div>

        <div className="mt-4">
          <h3 className="font-serif text-lg leading-tight">{book.title}</h3>

          <p className="text-muted-foreground mt-1 text-sm">{book.author}</p>

          <div className="text-muted-foreground mt-2 flex items-center gap-2 text-xs tracking-wide uppercase">
            {book.year && (
              <>
                <span>{book.year}</span>
                <span>·</span>
              </>
            )}

            <span>{book.language}</span>
          </div>

          {visibleCategories.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {visibleCategories.map((category) => (
                <Badge key={category.id} variant="secondary" className="max-w-full px-1.5 text-[10px] font-normal">
                  {category.name}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </Link>
    </article>
  );
}
