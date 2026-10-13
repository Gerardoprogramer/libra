export const READING_PROGRESS_PREFIX = "libra:progress:";
export const READING_PROGRESS_CHANGE_EVENT = "libra:reading-progress-change";

const SCOPED_READING_PROGRESS_PREFIX = "libra:reading-progress:v2:";

export type ReadingProgressScope =
  | {
      type: "guest";
    }
  | {
      type: "user";
      userId: string;
    };

export interface ReadingProgress {
  bookSlug: string;

  /**
   * Edition and chapter identifiers used for cloud synchronization.
   * Optional for compatibility with existing LocalStorage entries.
   */
  editionId?: string;
  contentLanguage?: string;
  /** Only new, explicitly scoped reader writes can enter the outbox. */
  pendingSync?: boolean;
  chapterSlug: string;
  chapterId?: string;

  chapterTitle: string;
  chapterNumber: number;

  /**
   * Zero-based paragraph currently being read.
   * Optional for compatibility with existing LocalStorage entries.
   */
  paragraphIndex?: number;

  /**
   * Percentage read inside the current chapter.
   * 0 - 100
   */
  percentage: number;

  /**
   * Zero-based position of the chapter inside the book.
   * Optional temporarily for compatibility with old localStorage data.
   */
  chapterIndex?: number;

  /**
   * Total amount of chapters in the book.
   */
  totalChapters?: number;

  updatedAt: string;
}

/**
 * Legacy key kept for compatibility with existing LocalStorage entries.
 */
export function getReadingProgressKey(bookSlug: string) {
  return `${READING_PROGRESS_PREFIX}${bookSlug}`;
}

/**
 * Returns the prefix used by scoped LocalStorage entries.
 */
function getScopedReadingProgressPrefix(scope: ReadingProgressScope) {
  if (scope.type === "guest") {
    return `${SCOPED_READING_PROGRESS_PREFIX}guest:`;
  }

  return `${SCOPED_READING_PROGRESS_PREFIX}user:${encodeURIComponent(scope.userId)}:`;
}

/**
 * Returns the LocalStorage key for a guest or authenticated user.
 */
export function getScopedReadingProgressKey(bookSlug: string, scope: ReadingProgressScope, editionId?: string) {
  const bookKey = `${getScopedReadingProgressPrefix(scope)}${encodeURIComponent(bookSlug)}`;
  return editionId ? `${bookKey}:edition:${encodeURIComponent(editionId)}` : bookKey;
}

/**
 * Legacy LocalStorage read.
 */
export function readReadingProgress(bookSlug: string): string | null {
  try {
    return window.localStorage.getItem(getReadingProgressKey(bookSlug)) ?? "";
  } catch {
    return null;
  }
}

/**
 * Scoped LocalStorage read.
 */
export function readScopedReadingProgress(
  bookSlug: string,
  scope: ReadingProgressScope,
  editionId?: string,
): string | null {
  try {
    const current = window.localStorage.getItem(getScopedReadingProgressKey(bookSlug, scope, editionId));
    if (current || !editionId) return current ?? "";
    // The previous scoped format is a cache, never an upload candidate.
    const previous = parseReadingProgress(window.localStorage.getItem(getScopedReadingProgressKey(bookSlug, scope)));
    return previous?.editionId === editionId ? JSON.stringify({ ...previous, pendingSync: false }) : "";
  } catch {
    return null;
  }
}

/**
 * Reads all legacy LocalStorage progress entries.
 */
export function readAllReadingProgress(): string[] | null {
  try {
    const entries: string[] = [];

    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);

      if (!key?.startsWith(READING_PROGRESS_PREFIX)) {
        continue;
      }

      const value = window.localStorage.getItem(key);
      const progress = parseReadingProgress(value);

      if (value && progress && key === getReadingProgressKey(progress.bookSlug)) {
        entries.push(value);
      }
    }

    return entries;
  } catch {
    return null;
  }
}

/**
 * Reads all progress entries belonging to one guest or authenticated user.
 */
export function readAllScopedReadingProgress(scope: ReadingProgressScope): string[] | null {
  try {
    const entries: string[] = [];
    const prefix = getScopedReadingProgressPrefix(scope);

    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);

      if (!key?.startsWith(prefix)) {
        continue;
      }

      const value = window.localStorage.getItem(key);
      const progress = parseReadingProgress(value);

      if (value && progress) {
        if (key === getScopedReadingProgressKey(progress.bookSlug, scope, progress.editionId)) {
          entries.push(value);
        } else if (key === getScopedReadingProgressKey(progress.bookSlug, scope)) {
          const editionKey = getScopedReadingProgressKey(progress.bookSlug, scope, progress.editionId);
          if (!progress.editionId || !window.localStorage.getItem(editionKey)) {
            entries.push(JSON.stringify({ ...progress, pendingSync: false }));
          }
        }
      }
    }

    return entries;
  } catch {
    return null;
  }
}

/**
 * Legacy LocalStorage write.
 */
export function saveReadingProgress(progress: ReadingProgress): boolean {
  try {
    window.localStorage.setItem(getReadingProgressKey(progress.bookSlug), JSON.stringify(progress));
  } catch {
    return false;
  }

  window.dispatchEvent(new Event(READING_PROGRESS_CHANGE_EVENT));

  return true;
}

/**
 * Scoped LocalStorage write.
 */
export function saveScopedReadingProgress(progress: ReadingProgress, scope: ReadingProgressScope): boolean {
  try {
    window.localStorage.setItem(
      getScopedReadingProgressKey(progress.bookSlug, scope, progress.editionId),
      JSON.stringify(progress),
    );
  } catch {
    return false;
  }

  window.dispatchEvent(new Event(READING_PROGRESS_CHANGE_EVENT));

  return true;
}

export function parseReadingProgress(value: string | null): ReadingProgress | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<ReadingProgress>;

    if (
      typeof parsed.bookSlug !== "string" ||
      !parsed.bookSlug.trim() ||
      typeof parsed.chapterSlug !== "string" ||
      !parsed.chapterSlug.trim() ||
      typeof parsed.chapterTitle !== "string" ||
      typeof parsed.chapterNumber !== "number" ||
      !Number.isInteger(parsed.chapterNumber) ||
      parsed.chapterNumber < 1 ||
      typeof parsed.percentage !== "number" ||
      !Number.isFinite(parsed.percentage) ||
      parsed.percentage < 0 ||
      parsed.percentage > 100 ||
      typeof parsed.updatedAt !== "string"
    ) {
      return null;
    }

    if (
      (parsed.chapterIndex !== undefined && (!Number.isInteger(parsed.chapterIndex) || parsed.chapterIndex < 0)) ||
      (parsed.totalChapters !== undefined && (!Number.isInteger(parsed.totalChapters) || parsed.totalChapters < 1)) ||
      (parsed.paragraphIndex !== undefined &&
        (!Number.isInteger(parsed.paragraphIndex) || parsed.paragraphIndex < 0)) ||
      (typeof parsed.chapterIndex === "number" &&
        typeof parsed.totalChapters === "number" &&
        parsed.chapterIndex >= parsed.totalChapters)
    ) {
      return null;
    }

    if (Number.isNaN(Date.parse(parsed.updatedAt))) {
      return null;
    }

    return {
      bookSlug: parsed.bookSlug,
      editionId: typeof parsed.editionId === "string" ? parsed.editionId : undefined,
      contentLanguage: typeof parsed.contentLanguage === "string" ? parsed.contentLanguage : undefined,
      pendingSync: parsed.pendingSync === true,
      chapterSlug: parsed.chapterSlug,
      chapterId: typeof parsed.chapterId === "string" ? parsed.chapterId : undefined,
      chapterTitle: parsed.chapterTitle,
      chapterNumber: parsed.chapterNumber,
      paragraphIndex: typeof parsed.paragraphIndex === "number" ? parsed.paragraphIndex : undefined,
      percentage: parsed.percentage,
      chapterIndex: typeof parsed.chapterIndex === "number" ? parsed.chapterIndex : undefined,
      totalChapters: typeof parsed.totalChapters === "number" ? parsed.totalChapters : undefined,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

export function readingProgressHref(progress: Pick<ReadingProgress, "bookSlug" | "chapterSlug" | "editionId">) {
  const pathname = `/books/${encodeURIComponent(progress.bookSlug)}/${encodeURIComponent(progress.chapterSlug)}`;
  return progress.editionId ? `${pathname}?edition=${encodeURIComponent(progress.editionId)}` : pathname;
}

export function calculateBookProgress(progress: ReadingProgress) {
  const chapterPercentage = Math.min(100, Math.max(0, progress.percentage));

  if (
    typeof progress.chapterIndex !== "number" ||
    typeof progress.totalChapters !== "number" ||
    progress.totalChapters <= 0
  ) {
    // Legacy localStorage entry.
    // Until the chapter is opened again,
    // keep showing its previous chapter percentage.
    return Math.round(chapterPercentage);
  }

  const completedChapters = progress.chapterIndex + chapterPercentage / 100;

  const bookPercentage = (completedChapters / progress.totalChapters) * 100;

  return Math.min(100, Math.max(0, Math.round(bookPercentage)));
}
