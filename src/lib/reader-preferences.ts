export type ReaderTheme = "light" | "sepia" | "dark";
export type ReaderWidth = "narrow" | "medium" | "wide";
export type ReaderFont = "literata" | "georgia" | "merriweather" | "lexend";

export interface ReaderPreferences {
  theme: ReaderTheme;
  width: ReaderWidth;
  fontSize: number;
  font: ReaderFont;
}

export const READER_PREFERENCES_STORAGE_KEY = "libra:reader-preferences";
export const READER_PREFERENCES_CHANGE_EVENT = "libra:reader-preferences-change";

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  theme: "light",
  width: "medium",
  fontSize: 20,
  font: "literata",
};

const READER_THEMES: readonly ReaderTheme[] = ["light", "sepia", "dark"];

// The typefaces of the chapter text, in the order the settings panel lists them. globals.css gives each its stack
// ([data-reader-font]); Georgia is the system's own, the others are bundled (src/lib/fonts/reading.ts).
export const READER_FONTS: readonly ReaderFont[] = ["literata", "georgia", "merriweather", "lexend"];

export const READER_FONT_SIZE_LIMITS = { min: 16, max: 30 } as const;

// Measure of each width, in ems of the text size, so a line keeps the same number of characters at every size: the
// chapter text (Literata) averages about 2.1 characters per em, which gives about 61, 68 and 76 characters per line.
// The other typefaces keep the same measures, so wider ones set a few characters less per line.
export const READER_MEASURES: Record<ReaderWidth, number> = {
  narrow: 29,
  medium: 32.5,
  wide: 36.5,
};

const READER_WIDTHS = Object.keys(READER_MEASURES) as ReaderWidth[];

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
      theme: READER_THEMES.includes(parsed.theme as ReaderTheme)
        ? (parsed.theme as ReaderTheme)
        : DEFAULT_READER_PREFERENCES.theme,
      width: READER_WIDTHS.includes(parsed.width as ReaderWidth)
        ? (parsed.width as ReaderWidth)
        : DEFAULT_READER_PREFERENCES.width,
      fontSize:
        typeof parsed.fontSize === "number"
          ? Math.min(Math.max(parsed.fontSize, READER_FONT_SIZE_LIMITS.min), READER_FONT_SIZE_LIMITS.max)
          : DEFAULT_READER_PREFERENCES.fontSize,
      font: READER_FONTS.includes(parsed.font as ReaderFont)
        ? (parsed.font as ReaderFont)
        : DEFAULT_READER_PREFERENCES.font,
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

// Before hydration the server's HTML carries the default preferences. The early script (earlyReaderPreferencesScript,
// run from <head> in src/app/[locale]/layout.tsx before the first paint) reads the stored ones and, only where they
// differ from the defaults, marks <html> with them; globals.css applies them to the reader and its placeholder. The
// reader removes the marks (clearEarlyReaderPreferences) once React renders the same values.
const EARLY_THEME_ATTRIBUTE = "data-reader-early-theme";
const EARLY_MEASURE_ATTRIBUTE = "data-reader-early-measure";
const EARLY_FONT_ATTRIBUTE = "data-reader-early-font";
const EARLY_FONT_SIZE_PROPERTY = "--reader-early-font-size";
const EARLY_MEASURE_PROPERTY = "--reader-early-measure";

// A fixed string built from the constants above, the same for every visitor: nothing stored is written into it. It
// validates as parseReaderPreferences does (same lists, limits and defaults; reader-preferences.test.ts runs both on
// the same inputs) and only writes a listed theme or typeface name and numbers it computed. A preference changed in
// another tab before the reader takes over removes the marks, so they never outlive the stored value they came from. It
// contains no "<", so inline in <head> it can never close its own tag.
export const earlyReaderPreferencesScript = `(function(){var d=document.documentElement;function c(){d.removeAttribute(${JSON.stringify(EARLY_THEME_ATTRIBUTE)});d.removeAttribute(${JSON.stringify(EARLY_MEASURE_ATTRIBUTE)});d.removeAttribute(${JSON.stringify(EARLY_FONT_ATTRIBUTE)});d.style.removeProperty(${JSON.stringify(EARLY_FONT_SIZE_PROPERTY)});d.style.removeProperty(${JSON.stringify(EARLY_MEASURE_PROPERTY)});if(!d.getAttribute("style"))d.removeAttribute("style")}try{var k=${JSON.stringify(READER_PREFERENCES_STORAGE_KEY)},s=localStorage.getItem(k);if(!s)return;var p=JSON.parse(s);if(!p||typeof p!=="object")return;var m=${JSON.stringify(READER_MEASURES)},t=${JSON.stringify(READER_THEMES)}.indexOf(p.theme)===-1?${JSON.stringify(DEFAULT_READER_PREFERENCES.theme)}:p.theme,w=${JSON.stringify(READER_WIDTHS)}.indexOf(p.width)===-1?${JSON.stringify(DEFAULT_READER_PREFERENCES.width)}:p.width,f=typeof p.fontSize==="number"?Math.min(Math.max(p.fontSize,${READER_FONT_SIZE_LIMITS.min}),${READER_FONT_SIZE_LIMITS.max}):${DEFAULT_READER_PREFERENCES.fontSize},n=${JSON.stringify(READER_FONTS)}.indexOf(p.font)===-1?${JSON.stringify(DEFAULT_READER_PREFERENCES.font)}:p.font;if(t!==${JSON.stringify(DEFAULT_READER_PREFERENCES.theme)})d.setAttribute(${JSON.stringify(EARLY_THEME_ATTRIBUTE)},t);if(n!==${JSON.stringify(DEFAULT_READER_PREFERENCES.font)})d.setAttribute(${JSON.stringify(EARLY_FONT_ATTRIBUTE)},n);if(f!==${DEFAULT_READER_PREFERENCES.fontSize}||w!==${JSON.stringify(DEFAULT_READER_PREFERENCES.width)}){d.style.setProperty(${JSON.stringify(EARLY_FONT_SIZE_PROPERTY)},f+"px");d.style.setProperty(${JSON.stringify(EARLY_MEASURE_PROPERTY)},m[w]*f+"px");d.setAttribute(${JSON.stringify(EARLY_MEASURE_ATTRIBUTE)},"")}addEventListener("storage",function(e){if(e.key===k||e.key===null)c()})}catch(e){}})()`;

// Idempotent: removes whatever marks the early script left on <html>, and nothing else.
export function clearEarlyReaderPreferences(root: HTMLElement = document.documentElement) {
  root.removeAttribute(EARLY_THEME_ATTRIBUTE);
  root.removeAttribute(EARLY_MEASURE_ATTRIBUTE);
  root.removeAttribute(EARLY_FONT_ATTRIBUTE);
  root.style.removeProperty(EARLY_FONT_SIZE_PROPERTY);
  root.style.removeProperty(EARLY_MEASURE_PROPERTY);
  if (!root.getAttribute("style")) root.removeAttribute("style");
}
