export const LIBRARY_STORAGE_KEY = "libra:library";
export const LIBRARY_CHANGE_EVENT = "libra:library-change";

export interface LibraryEntry {
  bookSlug: string;
  addedAt: string;
}

export function parseLibrary(value: string | null): LibraryEntry[] {
  if (!value) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return [];
    }

    const entries = new Map<string, LibraryEntry>();

    for (const entry of parsed) {
      if (
        typeof entry !== "object" ||
        entry === null ||
        typeof entry.bookSlug !== "string" ||
        !entry.bookSlug.trim() ||
        typeof entry.addedAt !== "string" ||
        !Number.isFinite(Date.parse(entry.addedAt))
      ) {
        continue;
      }

      const bookSlug = entry.bookSlug.trim();
      const addedAt = new Date(entry.addedAt).toISOString();
      const existing = entries.get(bookSlug);

      // Keep the most recent save if stored data contains duplicates.
      if (!existing || Date.parse(addedAt) > Date.parse(existing.addedAt)) {
        entries.set(bookSlug, { bookSlug, addedAt });
      }
    }

    return [...entries.values()].sort((first, second) => Date.parse(second.addedAt) - Date.parse(first.addedAt));
  } catch {
    return [];
  }
}

// A primitive snapshot stays stable between writes for useSyncExternalStore.
// null means storage is unavailable; an empty library is represented by "[]".
export function readLibrarySnapshot(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(LIBRARY_STORAGE_KEY) ?? "[]";
  } catch {
    return null;
  }
}

export function readLibrary(): LibraryEntry[] {
  return parseLibrary(readLibrarySnapshot());
}

function writeLibrary(entries: LibraryEntry[]): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    return false;
  }

  window.dispatchEvent(new Event(LIBRARY_CHANGE_EVENT));

  return true;
}

export function isBookInLibrary(bookSlug: string) {
  return readLibrary().some((entry) => entry.bookSlug === bookSlug.trim());
}

export function addBookToLibrary(bookSlug: string): boolean {
  const snapshot = readLibrarySnapshot();
  bookSlug = bookSlug.trim();

  if (snapshot === null || !bookSlug) {
    return false;
  }

  const entries = parseLibrary(snapshot);

  if (entries.some((entry) => entry.bookSlug === bookSlug)) {
    return true;
  }

  return writeLibrary([
    {
      bookSlug,
      addedAt: new Date().toISOString(),
    },
    ...entries,
  ]);
}

export function removeBookFromLibrary(bookSlug: string): boolean {
  const snapshot = readLibrarySnapshot();

  if (snapshot === null) {
    return false;
  }

  return writeLibrary(parseLibrary(snapshot).filter((entry) => entry.bookSlug !== bookSlug.trim()));
}

// The saved state after a successful write, or null if persistence failed.
export function toggleBookInLibrary(bookSlug: string): boolean | null {
  if (isBookInLibrary(bookSlug)) {
    return removeBookFromLibrary(bookSlug) ? false : null;
  }

  return addBookToLibrary(bookSlug) ? true : null;
}
