import assert from "node:assert/strict";
import { test } from "node:test";

import { getLatestReadingProgress, getRecentlyReadProgress } from "./reading-history";
import type { ReadingProgress } from "./reading-progress";

function progress(bookSlug: string, chapterSlug: string, updatedAt: string, percentage = 25): string {
  const entry: ReadingProgress = {
    bookSlug,
    chapterSlug,
    chapterTitle: chapterSlug,
    chapterNumber: 1,
    chapterIndex: 0,
    totalChapters: 10,
    percentage,
    updatedAt,
  };

  return JSON.stringify(entry);
}

test("continue reading selects the newest valid progress for an available book", () => {
  const entries = [
    progress("dracula", "chapter-1", "2026-09-28T10:00:00.000Z"),
    progress("frankenstein", "chapter-2", "2026-09-30T10:00:00.000Z"),
    progress("dracula", "chapter-3", "2026-09-29T10:00:00.000Z"),
    "{broken",
    progress("deleted-book", "chapter-1", "2026-10-01T10:00:00.000Z"),
  ];

  assert.equal(getLatestReadingProgress(entries, new Set(["dracula", "frankenstein"]))?.bookSlug, "frankenstein");
});

test("continue reading keeps valid zero and completed progress entries", () => {
  const zero = progress("dracula", "chapter-1", "2026-09-29T10:00:00.000Z", 0);
  const completed = progress("frankenstein", "last-chapter", "2026-09-30T10:00:00.000Z", 100);

  assert.equal(getLatestReadingProgress([zero], new Set(["dracula"]))?.percentage, 0);
  assert.equal(getLatestReadingProgress([completed], new Set(["frankenstein"]))?.percentage, 100);
});

test("recent reading keeps the latest chapter per available book, excludes the current book, and respects its limit", () => {
  const entries = [
    progress("dracula", "chapter-1", "2026-09-27T10:00:00.000Z"),
    progress("frankenstein", "chapter-1", "2026-09-29T10:00:00.000Z"),
    progress("dracula", "chapter-5", "2026-09-30T10:00:00.000Z"),
    progress("moby-dick", "chapter-2", "2026-09-28T10:00:00.000Z"),
    progress("deleted-book", "chapter-1", "2026-10-01T10:00:00.000Z"),
    "{broken",
    progress("alice", "chapter-1", "2026-09-26T10:00:00.000Z"),
  ];

  assert.deepEqual(
    getRecentlyReadProgress(entries, new Set(["dracula", "frankenstein", "moby-dick", "alice"]), 2).map(
      ({ bookSlug, chapterSlug }) => [bookSlug, chapterSlug],
    ),
    [
      ["frankenstein", "chapter-1"],
      ["moby-dick", "chapter-2"],
    ],
  );
});

test("recent reading returns an empty list when there is no progress and clamps negative limits", () => {
  assert.deepEqual(getRecentlyReadProgress([], new Set(["dracula"])), []);
  assert.deepEqual(
    getRecentlyReadProgress(
      [
        progress("dracula", "chapter-1", "2026-09-30T10:00:00.000Z"),
        progress("frankenstein", "chapter-1", "2026-09-29T10:00:00.000Z"),
      ],
      new Set(["dracula", "frankenstein"]),
      -1,
    ),
    [],
  );
});
