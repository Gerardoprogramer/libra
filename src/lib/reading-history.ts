import { parseReadingProgress, type ReadingProgress } from "./reading-progress";

export function getLatestReadingProgress(
  entries: readonly string[],
  availableBookSlugs: ReadonlySet<string>,
): ReadingProgress | null {
  let latestProgress: ReadingProgress | null = null;
  let latestUpdatedAt = -1;

  for (const value of [...entries].sort()) {
    const progress = parseReadingProgress(value);

    if (!progress || !availableBookSlugs.has(progress.bookSlug)) {
      continue;
    }

    const updatedAt = Date.parse(progress.updatedAt);

    if (updatedAt > latestUpdatedAt) {
      latestUpdatedAt = updatedAt;
      latestProgress = progress;
    }
  }

  return latestProgress;
}

export function getRecentlyReadProgress(
  entries: readonly string[],
  availableBookSlugs: ReadonlySet<string>,
  limit = 4,
): ReadingProgress[] {
  const parsedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;

  if (parsedLimit === 0) {
    return [];
  }

  const history = [...entries]
    .sort()
    .map((value) => parseReadingProgress(value))
    .filter((progress): progress is ReadingProgress => progress !== null && availableBookSlugs.has(progress.bookSlug))
    .sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt));

  const seenBookSlugs = new Set<string>();
  const uniqueHistory = history.filter((progress) => {
    if (seenBookSlugs.has(progress.bookSlug)) {
      return false;
    }

    seenBookSlugs.add(progress.bookSlug);
    return true;
  });

  return uniqueHistory.slice(1, parsedLimit + 1);
}
