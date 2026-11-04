"use client";

import Image from "next/image";

import { FiArrowRight, FiBookOpen } from "react-icons/fi";

import { Link } from "@/i18n/navigation";

import { calculateBookProgress, readingProgressHref } from "@/lib/reading-progress";
import { useReadingHistory } from "@/lib/use-reading-history";
import { getRecentlyReadProgress } from "@/lib/reading-history";

interface BookSummary {
  slug: string;
  title: string;
  author: string;
  coverUrl: string | null;
}

interface RecentlyReadProps {
  books: BookSummary[];
  title: string;
  continueLabel: string;
  limit?: number;
}

export function RecentlyRead({ books, title, continueLabel, limit = 4 }: RecentlyReadProps) {
  const { entries } = useReadingHistory();
  const recentProgress = getRecentlyReadProgress(
    entries.map((item) => JSON.stringify(item)),
    new Set(books.map((book) => book.slug)),
    limit,
  );

  const recentItems = recentProgress.flatMap((progress) => {
    const book = books.find((item) => item.slug === progress.bookSlug);

    if (!book) {
      return [];
    }

    return [
      {
        book,
        progress,
        percentage: calculateBookProgress(progress),
      },
    ];
  });

  if (recentItems.length === 0) {
    return null;
  }

  return (
    <section className="border-b">
      <div className="mx-auto max-w-7xl px-6 py-12 md:py-14">
        <div className="mb-8 flex items-center gap-2">
          <FiBookOpen className="text-muted-foreground" />

          <h2 className="section-title">{title}</h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {recentItems.map(({ book, progress, percentage }) => (
            <Link
              key={book.slug}
              href={readingProgressHref(progress)}
              className="group hover:border-foreground/20 flex min-w-0 gap-4 rounded-xl border p-3 transition hover:shadow-sm sm:gap-5 sm:p-4"
            >
              <div className="bg-muted relative aspect-2/3 w-16 shrink-0 overflow-hidden rounded-md sm:w-20">
                {book.coverUrl ? (
                  <Image src={book.coverUrl} alt="" fill sizes="80px" className="object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <FiBookOpen className="text-muted-foreground size-5" />
                  </div>
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-col justify-center">
                <p className="text-muted-foreground truncate text-sm">{book.author}</p>

                <h3 className="mt-1 truncate font-serif text-xl">{book.title}</h3>

                <div className="mt-4">
                  <div className="bg-muted h-1 overflow-hidden rounded-full">
                    <div
                      className="bg-foreground h-full rounded-full"
                      style={{
                        width: `${percentage}%`,
                      }}
                    />
                  </div>

                  <div className="text-muted-foreground mt-2 flex items-center justify-between text-xs">
                    <span>{percentage}%</span>

                    <span className="text-foreground flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                      {continueLabel}

                      <FiArrowRight className="shrink-0 transition-transform group-hover:translate-x-1" />
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
