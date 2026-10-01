"use client";

import { useMemo, useSyncExternalStore } from "react";

import {
  DEFAULT_READER_PREFERENCES,
  READER_PREFERENCES_CHANGE_EVENT,
  READER_PREFERENCES_STORAGE_KEY,
  getReaderPreferencesSnapshot,
  parseReaderPreferences,
  saveReaderPreferences,
  type ReaderPreferences,
  type ReaderTheme,
  type ReaderWidth,
} from "@/lib/reader-preferences";

export type { ReaderTheme, ReaderWidth } from "@/lib/reader-preferences";

function subscribe(callback: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === READER_PREFERENCES_STORAGE_KEY || event.key === null) {
      callback();
    }
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(READER_PREFERENCES_CHANGE_EVENT, callback);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(READER_PREFERENCES_CHANGE_EVENT, callback);
  };
}

function getServerSnapshot() {
  return JSON.stringify(DEFAULT_READER_PREFERENCES);
}

export function useReaderPreferences() {
  const snapshot = useSyncExternalStore<string | null>(subscribe, getReaderPreferencesSnapshot, getServerSnapshot);

  const preferences = useMemo(
    () => parseReaderPreferences(snapshot ?? JSON.stringify(DEFAULT_READER_PREFERENCES)),
    [snapshot],
  );

  function updatePreferences(values: Partial<ReaderPreferences>) {
    const nextPreferences: ReaderPreferences = {
      ...preferences,
      ...values,
    };

    return saveReaderPreferences(nextPreferences);
  }

  return {
    ...preferences,
    isAvailable: snapshot !== null,

    setTheme: (theme: ReaderTheme) => updatePreferences({ theme }),

    setWidth: (width: ReaderWidth) => updatePreferences({ width }),

    setFontSize: (fontSize: number) => updatePreferences({ fontSize }),
  };
}
