"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useReadingProgressScope } from "./use-reading-progress-scope";
import {
  parseReadingProgress,
  readAllScopedReadingProgress,
  READING_PROGRESS_CHANGE_EVENT,
  type ReadingProgress,
  type ReadingProgressScope,
} from "./reading-progress";
import { getCloudReadingProgressHistory, toReadingProgress } from "./reading-progress-cloud";
import { CLOUD_PROGRESS_SYNC_EVENT, replayPendingReadingProgress } from "./reading-progress-sync";

function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(READING_PROGRESS_CHANGE_EVENT, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(READING_PROGRESS_CHANGE_EVENT, notify);
  };
}
const getServerSnapshot = () => "[]";
const requests = new Map<string, Promise<ReadingProgress[]>>();

function readCloud(userId: string, editionId?: string, fresh = false) {
  const key = JSON.stringify([userId, editionId]);
  const existing = requests.get(key);
  if (existing && !fresh) return existing;
  const request = getCloudReadingProgressHistory(userId, editionId)
    .then((rows) => (rows ?? []).map(toReadingProgress))
    .finally(() => {
      if (requests.get(key) === request) requests.delete(key);
    });
  requests.set(key, request);
  return request;
}

export function mergeReadingHistory(
  cloud: ReadingProgress[] | null,
  local: ReadingProgress[],
  scope: ReadingProgressScope,
) {
  if (scope.type === "guest" || cloud === null) return local;
  const merged = new Map(cloud.map((item) => [item.editionId, item]));
  for (const item of local) {
    const saved = merged.get(item.editionId);
    if (
      item.editionId &&
      ((!saved && item.pendingSync) || (saved && Date.parse(item.updatedAt) > Date.parse(saved.updatedAt)))
    ) {
      merged.set(item.editionId, item);
    }
  }
  return [...merged.values()];
}

export function useReadingHistory(editionId?: string) {
  const scope = useReadingProgressScope();
  const getSnapshot = useCallback(() => {
    if (!scope) return "[]";
    const entries = readAllScopedReadingProgress(scope);
    return entries ? JSON.stringify(entries.sort()) : null;
  }, [scope]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [cloud, setCloud] = useState<{
    scope: ReadingProgressScope;
    editionId?: string;
    items: ReadingProgress[];
  } | null>(null);

  useEffect(() => {
    if (scope?.type !== "user") return;
    let cancelled = false;
    let generation = 0;
    const refresh = (fresh = false) => {
      const version = ++generation;
      void readCloud(scope.userId, editionId, fresh)
        .then((items) => {
          if (!cancelled && version === generation) setCloud({ scope, editionId, items });
        })
        .catch(() => {
          /* Offline: retain only this account's cache. */
        });
    };
    const online = () => {
      replayPendingReadingProgress(scope);
      refresh();
    };
    const saved = () => refresh(true);
    const focus = () => refresh();
    online();
    window.addEventListener(CLOUD_PROGRESS_SYNC_EVENT, saved);
    window.addEventListener("online", online);
    window.addEventListener("focus", focus);
    return () => {
      cancelled = true;
      window.removeEventListener(CLOUD_PROGRESS_SYNC_EVENT, saved);
      window.removeEventListener("online", online);
      window.removeEventListener("focus", focus);
    };
  }, [scope, editionId]);

  const entries = useMemo(() => {
    if (!scope) return [];
    const values = snapshot ? (JSON.parse(snapshot) as string[]) : [];
    const local = values.map(parseReadingProgress).filter((item): item is ReadingProgress => item !== null);
    const saved = cloud?.scope === scope && cloud.editionId === editionId ? cloud.items : null;
    return mergeReadingHistory(saved, local, scope).filter((item) => !editionId || item.editionId === editionId);
  }, [scope, snapshot, cloud, editionId]);
  return { entries, scope, storageAvailable: snapshot !== null };
}
