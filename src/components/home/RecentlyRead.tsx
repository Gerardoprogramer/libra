"use client";

import Image from "next/image";

import { useMemo, useSyncExternalStore } from "react";

import { FiArrowRight, FiBookOpen } from "react-icons/fi";

import { Link } from "@/i18n/navigation";

import {
  calculateBookProgress,
  parseReadingProgress,
  READING_PROGRESS_PREFIX,
  type ReadingProgress,
} from "@/lib/reading-progress";

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

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);

  return () => {
    window.removeEventListener("storage", callback);
  };
}

function getSnapshot() {
  const entries: string[] = [];

  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);

    if (!key?.startsWith(READING_PROGRESS_PREFIX)) {
      continue;
    }

    const value = localStorage.getItem(key);

    if (value) {
      entries.push(value);
    }
  }

  // Así el snapshot siempre tiene un orden estable.
  return JSON.stringify(entries.sort());
}

function getServerSnapshot() {
  return "[]";
}

export function RecentlyRead({ books, title, continueLabel, limit = 4 }: RecentlyReadProps) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const history = useMemo(() => {
    let values: string[];

    try {
      values = JSON.parse(snapshot) as string[];
    } catch {
      return [];
    }

    return values
      .map((value) => parseReadingProgress(value))
      .filter((progress): progress is ReadingProgress => progress !== null)
      .sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt));
  }, [snapshot]);

  if (history.length <= 1) {
    return null;
  }

  // El primero ya aparece en Continue Reading.
  // Evitamos mostrarlo dos veces.
  const recentItems = history
    .slice(1)
    .map((progress) => {
      const book = books.find((item) => item.slug === progress.bookSlug);

      if (!book) {
        return null;
      }

      return {
        book,
        progress,
        percentage: calculateBookProgress(progress),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, limit);

  if (recentItems.length === 0) {
    return null;
  }

  return (
    <section className="border-b">
      <div className="mx-auto max-w-7xl px-6 py-12 md:py-14">
        <div className="mb-8 flex items-center gap-2">
          <FiBookOpen className="text-muted-foreground" />

          <h2 className="font-serif text-2xl tracking-tight">{title}</h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {recentItems.map(({ book, progress, percentage }) => (
            <Link
              key={book.slug}
              href={`/books/${book.slug}/${progress.chapterSlug}`}
              className="group hover:border-foreground/20 flex gap-5 rounded-xl border p-4 transition hover:shadow-sm"
            >
              <div className="bg-muted relative aspect-2/3 w-20 shrink-0 overflow-hidden rounded-md">
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

                    <span className="text-foreground flex items-center gap-1.5">
                      {continueLabel}

                      <FiArrowRight className="transition-transform group-hover:translate-x-1" />
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
