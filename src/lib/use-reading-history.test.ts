import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeReadingHistory } from "./use-reading-history";
import type { ReadingProgress } from "./reading-progress";

const saved: ReadingProgress = {
  bookSlug: "dracula",
  editionId: "en",
  chapterId: "one",
  chapterSlug: "one",
  chapterTitle: "One",
  chapterNumber: 1,
  percentage: 40,
  updatedAt: "2026-01-02T00:00:00Z",
};
const scope = { type: "user", userId: "A" } as const;
test("an empty authoritative cloud history does not resurrect old confirmed caches", () => {
  assert.deepEqual(mergeReadingHistory([], [saved], scope), []);
  assert.deepEqual(mergeReadingHistory(null, [saved], scope), [saved]);
});
test("only newer scoped writes overlay a cloud entry while saving", () => {
  const newer = { ...saved, percentage: 60, updatedAt: "2026-01-03T00:00:00Z", pendingSync: true };
  const older = { ...saved, percentage: 10, updatedAt: "2026-01-01T00:00:00Z", pendingSync: true };
  assert.deepEqual(mergeReadingHistory([saved], [newer], scope), [newer]);
  assert.deepEqual(mergeReadingHistory([saved], [older], scope), [saved]);
  assert.deepEqual(mergeReadingHistory([], [newer], scope), [newer]);
});
