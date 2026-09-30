"use client";

import { useMemo, useSyncExternalStore } from "react";

import { LIBRARY_CHANGE_EVENT, LIBRARY_STORAGE_KEY, parseLibrary, readLibrarySnapshot } from "@/lib/library";

function subscribe(callback: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === LIBRARY_STORAGE_KEY || event.key === null) {
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

function getServerSnapshot() {
  return undefined;
}

export function useLibrary() {
  const snapshot = useSyncExternalStore<string | null | undefined>(subscribe, readLibrarySnapshot, getServerSnapshot);

  const isReady = snapshot !== undefined;

  const entries = useMemo(() => (snapshot === undefined ? [] : parseLibrary(snapshot)), [snapshot]);

  return {
    entries,
    isReady,
    isAvailable: isReady && snapshot !== null,
  };
}
