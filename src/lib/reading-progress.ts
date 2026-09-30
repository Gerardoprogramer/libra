export const READING_PROGRESS_PREFIX = "libra:progress:";

export interface ReadingProgress {
  bookSlug: string;
  chapterSlug: string;
  chapterTitle: string;
  chapterNumber: number;

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
   * Optional temporarily for compatibility with old localStorage data.
   */
  totalChapters?: number;

  updatedAt: string;
}

export function getReadingProgressKey(bookSlug: string) {
  return `${READING_PROGRESS_PREFIX}${bookSlug}`;
}

export function parseReadingProgress(value: string | null): ReadingProgress | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<ReadingProgress>;

    if (
      typeof parsed.bookSlug !== "string" ||
      typeof parsed.chapterSlug !== "string" ||
      typeof parsed.chapterTitle !== "string" ||
      typeof parsed.chapterNumber !== "number" ||
      typeof parsed.percentage !== "number" ||
      typeof parsed.updatedAt !== "string"
    ) {
      return null;
    }

    if (Number.isNaN(Date.parse(parsed.updatedAt))) {
      return null;
    }

    return {
      bookSlug: parsed.bookSlug,
      chapterSlug: parsed.chapterSlug,
      chapterTitle: parsed.chapterTitle,
      chapterNumber: parsed.chapterNumber,
      percentage: parsed.percentage,
      chapterIndex: typeof parsed.chapterIndex === "number" ? parsed.chapterIndex : undefined,
      totalChapters: typeof parsed.totalChapters === "number" ? parsed.totalChapters : undefined,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
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
