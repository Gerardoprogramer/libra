"use client";

import { useCallback, useSyncExternalStore } from "react";
import { FiBookOpen } from "react-icons/fi";

import { Button } from "@/components/ui/button";
import { calculateBookProgress, getReadingProgressKey, parseReadingProgress } from "@/lib/reading-progress";
import { Link } from "@/i18n/navigation";

interface BookReadingActionProps {
  bookSlug: string;
  chapterSlugs: string[];
  firstChapterSlug: string;
  startLabel: string;
  continueLabel: string;
  readAgainLabel: string;
  progressLabel: string;
}

function subscribe(bookSlug: string, callback: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === getReadingProgressKey(bookSlug) || event.key === null) {
      callback();
    }
  };

  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener("storage", handleStorage);
  };
}

function getProgressSnapshot(bookSlug: string) {
  return localStorage.getItem(getReadingProgressKey(bookSlug)) ?? "";
}

function getServerSnapshot() {
  return "";
}

export function BookReadingAction({
  bookSlug,
  chapterSlugs,
  firstChapterSlug,
  startLabel,
  continueLabel,
  readAgainLabel,
  progressLabel,
}: BookReadingActionProps) {
  const subscribeToProgress = useCallback((callback: () => void) => subscribe(bookSlug, callback), [bookSlug]);
  const readProgress = useCallback(() => getProgressSnapshot(bookSlug), [bookSlug]);
  const snapshot = useSyncExternalStore(subscribeToProgress, readProgress, getServerSnapshot);
  const progress = parseReadingProgress(snapshot);
  const hasValidProgress = progress && chapterSlugs.includes(progress.chapterSlug);
  const percentage = hasValidProgress ? calculateBookProgress(progress) : null;
  const isComplete = percentage === 100 && progress?.chapterSlug === chapterSlugs.at(-1);
  const chapterSlug = hasValidProgress && !isComplete ? progress.chapterSlug : firstChapterSlug;
  const label = isComplete ? readAgainLabel : hasValidProgress ? continueLabel : startLabel;
  const progressText = percentage === null ? null : progressLabel.replace("{progress}", String(percentage));

  return (
    <div className="min-w-0">
      <Button size="lg" asChild>
        <Link href={`/books/${bookSlug}/${chapterSlug}`}>
          <FiBookOpen />
          {label}
        </Link>
      </Button>

      {percentage !== null && (
        <div className="mt-3 max-w-sm">
          <div
            role="progressbar"
            aria-label={progressText ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentage}
            className="bg-muted h-1.5 overflow-hidden rounded-full"
          >
            <div className="bg-primary h-full transition-[width]" style={{ width: `${percentage}%` }} />
          </div>
          <p className="text-muted-foreground mt-1.5 text-xs">{progressText}</p>
        </div>
      )}
    </div>
  );
}
