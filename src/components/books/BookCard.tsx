import { Link } from "@/i18n/navigation";
import { FaStar } from "react-icons/fa6";

import type { Book } from "@/data/books";

interface BookCardProps {
  book: Book;
}

export function BookCard({ book }: BookCardProps) {
  return (
    <Link href={`/books/${book.slug}`} className="group block space-y-3">
      <div
        className={`relative aspect-2/3 overflow-hidden rounded-md bg-linear-to-br ${book.cover} shadow-sm transition duration-300 group-hover:-translate-y-1 group-hover:shadow-xl`}
      >
        <div className="absolute inset-0 bg-black/10" />

        <div className="absolute inset-x-5 top-8 text-center">
          <p className="text-[10px] tracking-[0.3em] text-white/60 uppercase">{book.category}</p>
        </div>

        <div className="absolute inset-x-5 top-1/2 -translate-y-1/2 text-center">
          <h3 className="font-serif text-xl font-medium text-white">{book.title}</h3>

          <div className="mx-auto my-4 h-px w-10 bg-white/40" />

          <p className="text-xs text-white/70">{book.author}</p>
        </div>

        <div className="absolute inset-x-5 bottom-6 text-center">
          <p className="text-[10px] tracking-widest text-white/40">{book.year}</p>
        </div>
      </div>

      <div>
        <h3 className="line-clamp-1 font-medium tracking-tight">{book.title}</h3>

        <div className="mt-1 flex items-center justify-between">
          <p className="text-muted-foreground text-sm">{book.author}</p>

          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <FaStar className="text-amber-500" />
            {book.rating}
          </span>
        </div>
      </div>
    </Link>
  );
}
