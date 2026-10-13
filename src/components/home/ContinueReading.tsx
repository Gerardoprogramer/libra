"use client";

import Image from "next/image";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { FiArrowRight, FiBookOpen } from "react-icons/fi";

import { Link } from "@/i18n/navigation";

import {
  calculateBookProgress,
  parseReadingProgress,
  readAllScopedReadingProgress,
  READING_PROGRESS_CHANGE_EVENT,
  type ReadingProgress,
  type ReadingProgressScope,
} from "@/lib/reading-progress";
import { useReadingProgressScope } from "@/lib/use-reading-progress-scope";
import { getLatestReadingProgress } from "@/lib/reading-history";
import { getCloudReadingProgressHistory, toReadingProgress } from "@/lib/reading-progress-cloud";

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

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(READING_PROGRESS_CHANGE_EVENT, callback);

  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(READING_PROGRESS_CHANGE_EVENT, callback);
  };
}

function getProgressSnapshot(bookSlugs: ReadonlySet<string>, scope: ReadingProgressScope | null): string | null {
  if (!scope) {
    return "";
  }

  const entries = readAllScopedReadingProgress(scope);

  if (!entries) {
    return null;
  }

  const progress = getLatestReadingProgress(entries, bookSlugs);

  return progress ? JSON.stringify(progress) : "";
}

function getServerSnapshot() {
  return "";
}

export function ContinueReading({
  books,
  title,
  chapterLabel,
  continueLabel,
  storageUnavailableLabel,
}: ContinueReadingProps) {
  const bookSlugs = useMemo(() => new Set(books.map((book) => book.slug)), [books]);
  const scope = useReadingProgressScope();

  const userId = scope?.type === "user" ? scope.userId : null;
  const subscribeToProgress = useCallback((callback: () => void) => subscribe(callback), []);
  const readProgress = useCallback(() => getProgressSnapshot(bookSlugs, scope), [bookSlugs, scope]);
  const snapshot = useSyncExternalStore(subscribeToProgress, readProgress, getServerSnapshot);

  const [cloudProgress, setCloudProgress] = useState<{
    userId: string;
    items: ReadingProgress[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!userId) {
      return () => {
        cancelled = true;
      };
    }

    void getCloudReadingProgressHistory()
      .then((items) => {
        if (cancelled) {
          return;
        }

        setCloudProgress({
          userId,
          items: items?.map(toReadingProgress) ?? [],
        });
      })
      .catch(() => {
        if (!cancelled) {
          setCloudProgress(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const localProgress = useMemo<ReadingProgress | null>(() => parseReadingProgress(snapshot), [snapshot]);

  const activeCloudProgress = cloudProgress?.userId === userId ? cloudProgress.items : null;

  const cloudEntries = useMemo(
    () => activeCloudProgress?.map((item) => JSON.stringify(item)) ?? [],
    [activeCloudProgress],
  );

  const cloudLatestProgress = useMemo(() => {
    if (!activeCloudProgress || activeCloudProgress.length === 0) {
      return null;
    }

    return getLatestReadingProgress(cloudEntries, bookSlugs);
  }, [activeCloudProgress, bookSlugs, cloudEntries]);

  const progress = cloudLatestProgress ?? localProgress;

  if (snapshot === null) {
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
          href={`/books/${book.slug}/${progress.chapterSlug}`}
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
