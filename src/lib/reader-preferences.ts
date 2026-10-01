export type ReaderTheme = "light" | "sepia" | "dark";
export type ReaderWidth = "narrow" | "medium" | "wide";

export interface ReaderPreferences {
  theme: ReaderTheme;
  width: ReaderWidth;
  fontSize: number;
}

export const READER_PREFERENCES_STORAGE_KEY = "libra:reader-preferences";
export const READER_PREFERENCES_CHANGE_EVENT = "libra:reader-preferences-change";

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  theme: "light",
  width: "medium",
  fontSize: 20,
};

const defaultSnapshot = JSON.stringify(DEFAULT_READER_PREFERENCES);

export function getReaderPreferencesSnapshot(): string | null {
  try {
    return window.localStorage.getItem(READER_PREFERENCES_STORAGE_KEY) ?? defaultSnapshot;
  } catch {
    return null;
  }
}

export function parseReaderPreferences(snapshot: string): ReaderPreferences {
  try {
    const parsed = JSON.parse(snapshot) as Partial<ReaderPreferences>;

    return {
      theme:
        parsed.theme === "light" || parsed.theme === "sepia" || parsed.theme === "dark"
          ? parsed.theme
          : DEFAULT_READER_PREFERENCES.theme,
      width:
        parsed.width === "narrow" || parsed.width === "medium" || parsed.width === "wide"
          ? parsed.width
          : DEFAULT_READER_PREFERENCES.width,
      fontSize:
        typeof parsed.fontSize === "number"
          ? Math.min(Math.max(parsed.fontSize, 16), 30)
          : DEFAULT_READER_PREFERENCES.fontSize,
    };
  } catch {
    return DEFAULT_READER_PREFERENCES;
  }
}

export function saveReaderPreferences(preferences: ReaderPreferences): boolean {
  try {
    window.localStorage.setItem(READER_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    return false;
  }

  window.dispatchEvent(new Event(READER_PREFERENCES_CHANGE_EVENT));

  return true;
}
