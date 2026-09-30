"use client";

import { useMemo, useSyncExternalStore } from "react";

import { LIBRARY_CHANGE_EVENT, LIBRARY_STORAGE_KEY, parseLibrary, readLibrary } from "@/lib/library";

const SERVER_SNAPSHOT = "__server__";

function subscribe(callback: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === LIBRARY_STORAGE_KEY) {
      callback();
    }
  };

  window.addEventListener("storage", handleStorage);

  window.addEventListener(LIBRARY_CHANGE_EVENT, callback);

  return () => {
    window.removeEventListener("storage", handleStorage);

    window.removeEventListener(LIBRARY_CHANGE_EVENT, callback);
  };
}

function getSnapshot() {
  return JSON.stringify(readLibrary());
}

function getServerSnapshot() {
  return SERVER_SNAPSHOT;
}

export function useLibrary() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const isReady = snapshot !== SERVER_SNAPSHOT;

  const entries = useMemo(() => (isReady ? parseLibrary(snapshot) : []), [snapshot, isReady]);

  return {
    entries,
    isReady,
  };
}
