"use client";

import { useCallback, useSyncExternalStore } from "react";
import { FiBookOpen } from "react-icons/fi";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import {
  calculateBookProgress,
  getScopedReadingProgressKey,
  parseReadingProgress,
  readScopedReadingProgress,
  READING_PROGRESS_CHANGE_EVENT,
  type ReadingProgressScope,
} from "@/lib/reading-progress";

import { useReadingProgressScope } from "@/lib/use-reading-progress-scope";

interface BookReadingActionProps {
  bookSlug: string;
  chapterSlugs: string[];
  firstChapterSlug: string;
  startLabel: string;
  continueLabel: string;
  readAgainLabel: string;
  progressLabel: string;
}

function subscribe(bookSlug: string, scope: ReadingProgressScope | null, callback: () => void) {
  if (!scope) {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === getScopedReadingProgressKey(bookSlug, scope) || event.key === null) {
      callback();
    }
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(READING_PROGRESS_CHANGE_EVENT, callback);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(READING_PROGRESS_CHANGE_EVENT, callback);
  };
}

function getProgressSnapshot(bookSlug: string, scope: ReadingProgressScope | null) {
  if (!scope) {
    return "";
  }

  return readScopedReadingProgress(bookSlug, scope) ?? "";
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
  const scope = useReadingProgressScope();
  const subscribeToProgress = useCallback(
    (callback: () => void) => subscribe(bookSlug, scope, callback),
    [bookSlug, scope],
  );

  const readProgress = useCallback(() => getProgressSnapshot(bookSlug, scope), [bookSlug, scope]);

  const snapshot = useSyncExternalStore(subscribeToProgress, readProgress, getServerSnapshot);

  const parsedProgress = parseReadingProgress(snapshot);
  const progress = parsedProgress?.bookSlug === bookSlug ? parsedProgress : null;

  const hasValidProgress = progress !== null && chapterSlugs.includes(progress.chapterSlug);

  const percentage = hasValidProgress ? calculateBookProgress(progress) : null;

  const lastChapterSlug = chapterSlugs[chapterSlugs.length - 1];

  const isComplete = percentage === 100 && progress?.chapterSlug === lastChapterSlug;

  const chapterSlug = hasValidProgress && !isComplete ? progress.chapterSlug : firstChapterSlug;

  const label = isComplete ? readAgainLabel : hasValidProgress ? continueLabel : startLabel;

  const progressText = percentage === null ? null : progressLabel.replace("{progress}", String(percentage));

  return (
    <div className="min-h-20 min-w-0">
      <Button size="lg" asChild>
        <Link href={`/books/${bookSlug}/${chapterSlug}`}>
          <FiBookOpen aria-hidden="true" />
          <span className="grid">
            <span className="col-start-1 row-start-1">{label}</span>
            {/* Reserve the widest translated label before localStorage hydrates. */}
            {[startLabel, continueLabel, readAgainLabel].map((text) => (
              <span key={text} aria-hidden="true" className="invisible col-start-1 row-start-1">
                {text}
              </span>
            ))}
          </span>
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
            aria-valuetext={progressText ?? undefined}
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
