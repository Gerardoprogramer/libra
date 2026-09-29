import { Link } from "@/i18n/navigation";

import type { BookListItem } from "@/db/queries/books";

interface BookCardProps {
  book: BookListItem;
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

export function BookCard({ book }: BookCardProps) {
  const coverStyle = getCoverStyle(book.slug);

  return (
    <article>
      <Link href={`/books/${book.slug}`} className="group block">
        <div
          className={`relative aspect-2/3 overflow-hidden rounded-lg bg-linear-to-br ${coverStyle} shadow-lg transition duration-300 group-hover:-translate-y-1 group-hover:shadow-xl`}
        >
          <div className="absolute inset-0 flex flex-col justify-between p-5 text-white">
            <span className="text-xs font-medium tracking-[0.2em] text-white/60 uppercase">{book.language}</span>

            <div>
              <h3 className="font-serif text-xl leading-tight">{book.title}</h3>

              <p className="mt-2 text-sm text-white/65">{book.author}</p>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <h3 className="font-serif text-lg leading-tight">{book.title}</h3>

          <p className="text-muted-foreground mt-1 text-sm">{book.author}</p>

          <div className="text-muted-foreground mt-2 flex items-center gap-2 text-xs tracking-wide uppercase">
            {book.year && <span>{book.year}</span>}

            {book.year && <span>·</span>}

            <span>{book.language}</span>
          </div>
        </div>
      </Link>
    </article>
  );
}
