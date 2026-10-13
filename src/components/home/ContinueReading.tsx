"use client";

import Image from "next/image";

import { FiArrowRight, FiBookOpen } from "react-icons/fi";

import { Link } from "@/i18n/navigation";

import { calculateBookProgress, readingProgressHref } from "@/lib/reading-progress";
import { useReadingHistory } from "@/lib/use-reading-history";
import { getLatestReadingProgress } from "@/lib/reading-history";

interface BookSummary {
  slug: string;
  title: string;
  author: string;
  coverUrl: string | null;
}

interface ContinueReadingProps {
  books: BookSummary[];
  title: string;
  chapterLabel: string;
  continueLabel: string;
  storageUnavailableLabel: string;
}

export function ContinueReading({
  books,
  title,
  chapterLabel,
  continueLabel,
  storageUnavailableLabel,
}: ContinueReadingProps) {
  const { entries, storageAvailable } = useReadingHistory();
  const progress = getLatestReadingProgress(
    entries.map((item) => JSON.stringify(item)),
    new Set(books.map((book) => book.slug)),
  );

  if (!storageAvailable && !progress) {
    return (
      <section className="border-b px-6 py-8">
        <p role="alert" className="text-muted-foreground mx-auto max-w-7xl text-sm">
          {storageUnavailableLabel}
        </p>
      </section>
    );
  }

  if (!progress) {
    return null;
  }

  const book = books.find((item) => item.slug === progress.bookSlug);

  if (!book) {
    return null;
  }

  const percentage = calculateBookProgress(progress);

  return (
    <section className="border-b">
      <div className="mx-auto max-w-7xl px-6 py-12 md:py-16">
        <div className="mb-6 flex items-center gap-2">
          <FiBookOpen className="text-muted-foreground" />

          <h2 className="font-serif text-2xl">{title}</h2>
        </div>

        <Link
          href={readingProgressHref(progress)}
          className="group bg-card hover:border-foreground/20 grid overflow-hidden rounded-xl border transition hover:shadow-sm sm:grid-cols-[120px_1fr]"
        >
          <div className="bg-muted relative hidden aspect-2/3 overflow-hidden sm:block">
            {book.coverUrl ? (
              <Image src={book.coverUrl} alt="" fill sizes="120px" className="object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center">
                <FiBookOpen className="text-muted-foreground size-7" />
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-col justify-center p-6 md:p-8">
            <p className="text-muted-foreground mb-2 text-sm">{book.author}</p>

            <h3 className="font-serif text-2xl tracking-tight">{book.title}</h3>

            <p className="text-muted-foreground mt-3 text-sm">
              {chapterLabel} {progress.chapterNumber}: {progress.chapterTitle}
            </p>

            <div className="mt-6">
              <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                <div
                  className="bg-foreground h-full rounded-full transition-all"
                  style={{
                    width: `${percentage}%`,
                  }}
                />
              </div>

              <div className="text-muted-foreground mt-2 flex items-center justify-between text-xs">
                <span>{percentage}%</span>

                <span className="text-foreground flex items-center gap-2 font-medium">
                  {continueLabel}

                  <FiArrowRight className="transition-transform group-hover:translate-x-1" />
                </span>
              </div>
            </div>
          </div>
        </Link>
      </div>
    </section>
  );
}
