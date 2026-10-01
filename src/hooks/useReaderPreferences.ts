"use client";

import { useMemo, useSyncExternalStore } from "react";

export type ReaderTheme = "light" | "sepia" | "dark";
export type ReaderWidth = "narrow" | "medium" | "wide";

interface ReaderPreferences {
  theme: ReaderTheme;
  width: ReaderWidth;
  fontSize: number;
}

const STORAGE_KEY = "libra:reader-preferences";
const CHANGE_EVENT = "libra:reader-preferences-change";

const defaultPreferences: ReaderPreferences = {
  theme: "light",
  width: "medium",
  fontSize: 20,
};

const defaultSnapshot = JSON.stringify(defaultPreferences);

function subscribe(callback: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      callback();
    }
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(CHANGE_EVENT, callback);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

function getSnapshot(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? defaultSnapshot;
  } catch {
    return null;
  }
}

function getServerSnapshot() {
  return defaultSnapshot;
}

function parsePreferences(snapshot: string): ReaderPreferences {
  try {
    const parsed = JSON.parse(snapshot) as Partial<ReaderPreferences>;

    return {
      theme:
        parsed.theme === "light" || parsed.theme === "sepia" || parsed.theme === "dark"
          ? parsed.theme
          : defaultPreferences.theme,

      width:
        parsed.width === "narrow" || parsed.width === "medium" || parsed.width === "wide"
          ? parsed.width
          : defaultPreferences.width,

      fontSize:
        typeof parsed.fontSize === "number" ? Math.min(Math.max(parsed.fontSize, 16), 30) : defaultPreferences.fontSize,
    };
  } catch {
    return defaultPreferences;
  }
}

export function useReaderPreferences() {
  const snapshot = useSyncExternalStore<string | null>(subscribe, getSnapshot, getServerSnapshot);

  const preferences = useMemo(() => parsePreferences(snapshot ?? defaultSnapshot), [snapshot]);

  function updatePreferences(values: Partial<ReaderPreferences>) {
    const nextPreferences: ReaderPreferences = {
      ...preferences,
      ...values,
    };

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextPreferences));
    } catch {
      return false;
    }

    window.dispatchEvent(new Event(CHANGE_EVENT));

    return true;
  }

  return {
    ...preferences,
    isAvailable: snapshot !== null,

    setTheme: (theme: ReaderTheme) => updatePreferences({ theme }),

    setWidth: (width: ReaderWidth) => updatePreferences({ width }),

    setFontSize: (fontSize: number) => updatePreferences({ fontSize }),
  };
}
