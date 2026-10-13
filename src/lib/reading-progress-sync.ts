"use client";

import {
  getScopedReadingProgressKey,
  parseReadingProgress,
  readAllScopedReadingProgress,
  readScopedReadingProgress,
  READING_PROGRESS_CHANGE_EVENT,
  saveScopedReadingProgress,
  type ReadingProgress,
  type ReadingProgressScope,
} from "./reading-progress";
import { saveCloudReadingProgress } from "./reading-progress-cloud";

type UserScope = Extract<ReadingProgressScope, { type: "user" }>;
type PendingSave = { scope: UserScope; progress: ReadingProgress; timer: ReturnType<typeof setTimeout> };
const pending = new Map<string, PendingSave>();
export const CLOUD_PROGRESS_SYNC_EVENT = "libra:cloud-progress-sync";
let lastTimestamp = 0;

export function nextProgressTimestamp(previous?: string) {
  lastTimestamp = Math.max(Date.now(), lastTimestamp + 1, previous ? Date.parse(previous) + 1 : 0);
  return new Date(lastTimestamp).toISOString();
}

async function send(scope: UserScope, progress: ReadingProgress) {
  if (!progress.editionId || !progress.chapterId) return;
  try {
    const accepted = await saveCloudReadingProgress(
      {
        editionId: progress.editionId,
        chapterId: progress.chapterId,
        paragraphIndex: progress.paragraphIndex ?? 0,
        percentage: progress.percentage,
        updatedAt: progress.updatedAt,
      },
      scope.userId,
    );
    window.dispatchEvent(new Event(CLOUD_PROGRESS_SYNC_EVENT));
    const current = parseReadingProgress(readScopedReadingProgress(progress.bookSlug, scope, progress.editionId));
    // Old acknowledgements cannot replace newer local coordinates.
    if (current?.updatedAt !== progress.updatedAt) return;
    if (accepted) saveScopedReadingProgress({ ...current, pendingSync: false }, scope);
    else {
      window.localStorage.removeItem(getScopedReadingProgressKey(progress.bookSlug, scope, progress.editionId));
      window.dispatchEvent(new Event(READING_PROGRESS_CHANGE_EVENT));
    }
  } catch {
    // The scoped outbox survives failure and is replayed only by its owner.
  }
}

export function flushReadingProgress(scope: ReadingProgressScope, editionId?: string) {
  if (scope.type !== "user") return;
  for (const [key, item] of pending) {
    if (item.scope.userId !== scope.userId || (editionId && item.progress.editionId !== editionId)) continue;
    clearTimeout(item.timer);
    pending.delete(key);
    void send(item.scope, item.progress);
  }
}

export function queueReadingProgress(scope: ReadingProgressScope, progress: ReadingProgress): boolean {
  const stored = saveScopedReadingProgress({ ...progress, pendingSync: scope.type === "user" }, scope);
  if (scope.type === "guest" || !progress.editionId || !progress.chapterId) return stored;
  const key = getScopedReadingProgressKey(progress.bookSlug, scope, progress.editionId);
  const previous = pending.get(key);
  if (previous) clearTimeout(previous.timer);
  // Coalesce scroll writes only. Navigation/restoration never waits on a timer.
  const timer = setTimeout(() => flushReadingProgress(scope, progress.editionId), 1200);
  pending.set(key, { scope, progress, timer });
  return stored;
}

export function replayPendingReadingProgress(scope: ReadingProgressScope) {
  if (scope.type !== "user") return;
  for (const entry of readAllScopedReadingProgress(scope) ?? []) {
    const progress = parseReadingProgress(entry);
    if (progress?.pendingSync && progress.editionId && progress.chapterId) void send(scope, progress);
  }
}
