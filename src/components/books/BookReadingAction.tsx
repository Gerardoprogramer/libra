"use client";

import { FiBookOpen } from "react-icons/fi";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { calculateBookProgress, readingProgressHref } from "@/lib/reading-progress";
import { useReadingHistory } from "@/lib/use-reading-history";

interface BookReadingActionProps {
  bookSlug: string;
  editionId: string;
  chapterSlugs: string[];
  firstChapterSlug: string;
  startLabel: string;
  continueLabel: string;
  readAgainLabel: string;
  progressLabel: string;
}

export function BookReadingAction({
  bookSlug,
  editionId,
  chapterSlugs,
  firstChapterSlug,
  startLabel,
  continueLabel,
  readAgainLabel,
  progressLabel,
}: BookReadingActionProps) {
  const { entries } = useReadingHistory(editionId);
  const progress = entries.find((item) => item.bookSlug === bookSlug && item.editionId === editionId) ?? null;

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
        <Link href={readingProgressHref({ bookSlug, editionId, chapterSlug })}>
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
