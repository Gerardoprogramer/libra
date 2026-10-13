"use client";

import { getCloudReadingProgress } from "./reading-progress-cloud";
import {
  parseReadingProgress,
  readScopedReadingProgress,
  saveScopedReadingProgress,
  type ReadingProgress,
  type ReadingProgressScope,
} from "./reading-progress";
import { flushReadingProgress, nextProgressTimestamp, queueReadingProgress } from "./reading-progress-sync";

type ChapterPosition = Required<
  Pick<
    ReadingProgress,
    | "bookSlug"
    | "editionId"
    | "chapterId"
    | "chapterSlug"
    | "chapterTitle"
    | "chapterNumber"
    | "chapterIndex"
    | "totalChapters"
    | "contentLanguage"
  >
>;

/** A chapter URL is an explicit choice. This controller cannot navigate. */
export function createReadingSession(
  scope: ReadingProgressScope,
  chapter: ChapterPosition,
  restore: (progress: ReadingProgress | null) => void,
  storageUnavailable: () => void,
) {
  let closed = false;
  let revision = 0;
  const snapshot = readScopedReadingProgress(chapter.bookSlug, scope, chapter.editionId);
  const cached = parseReadingProgress(snapshot);
  let latestTimestamp = cached?.updatedAt;
  const matchesChapter = (progress: ReadingProgress | null) =>
    progress?.editionId === chapter.editionId && progress.chapterId === chapter.chapterId;

  function record(percentage: number, paragraphIndex: number) {
    if (closed) return;
    revision += 1;
    const current = parseReadingProgress(readScopedReadingProgress(chapter.bookSlug, scope, chapter.editionId));
    if (current && Date.parse(current.updatedAt) > Date.parse(latestTimestamp ?? "1970-01-01"))
      latestTimestamp = current.updatedAt;
    latestTimestamp = nextProgressTimestamp(latestTimestamp);
    if (!queueReadingProgress(scope, { ...chapter, percentage, paragraphIndex, updatedAt: latestTimestamp })) {
      storageUnavailable();
    }
  }

  async function start() {
    if (snapshot === null) storageUnavailable();
    const local = matchesChapter(cached) ? cached : null;
    restore(local);
    if (scope.type === "guest") {
      if (!local) record(0, 0);
      return;
    }
    // Only an explicit, unsent write from this account may be replayed.
    if (local?.pendingSync) {
      queueReadingProgress(scope, local);
    }
    try {
      const cloud = await getCloudReadingProgress(chapter.editionId, scope.userId);
      if (closed || revision !== 0) return;
      const current = parseReadingProgress(readScopedReadingProgress(chapter.bookSlug, scope, chapter.editionId));
      if (
        current &&
        current.updatedAt !== cached?.updatedAt &&
        (!cloud || Date.parse(current.updatedAt) >= Date.parse(cloud.updated_at))
      )
        return;
      if (local?.pendingSync && (!cloud || Date.parse(local.updatedAt) >= Date.parse(cloud.updated_at))) return;
      if (cloud && Date.parse(cloud.updated_at) > Date.parse(latestTimestamp ?? "1970-01-01")) {
        latestTimestamp = cloud.updated_at;
      }
      if (cloud?.chapter_id === chapter.chapterId) {
        const progress: ReadingProgress = {
          ...chapter,
          percentage: cloud.percentage,
          paragraphIndex: cloud.paragraph_index,
          updatedAt: cloud.updated_at,
        };
        if (!saveScopedReadingProgress(progress, scope)) storageUnavailable();
        restore(progress);
      } else {
        // The saved chapter is only used by the separate Continue action.
        restore(null);
        record(0, 0);
      }
    } catch {
      // Scoped cache remains usable offline; an active reader never waits here.
    }
  }

  return {
    start,
    record,
    interact() {
      revision += 1;
    },
    flush() {
      flushReadingProgress(scope, chapter.editionId);
    },
    dispose() {
      closed = true;
      flushReadingProgress(scope, chapter.editionId);
    },
  };
}
