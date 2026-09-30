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
    const parsed = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (entry): entry is LibraryEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.bookSlug === "string" &&
        typeof entry.addedAt === "string",
    );
  } catch {
    return [];
  }
}

export function readLibrary(): LibraryEntry[] {
  if (typeof window === "undefined") {
    return [];
  }

  return parseLibrary(localStorage.getItem(LIBRARY_STORAGE_KEY));
}

function writeLibrary(entries: LibraryEntry[]) {
  localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(entries));

  window.dispatchEvent(new Event(LIBRARY_CHANGE_EVENT));
}

export function isBookInLibrary(bookSlug: string) {
  return readLibrary().some((entry) => entry.bookSlug === bookSlug);
}

export function addBookToLibrary(bookSlug: string) {
  const entries = readLibrary();

  if (entries.some((entry) => entry.bookSlug === bookSlug)) {
    return;
  }

  writeLibrary([
    {
      bookSlug,
      addedAt: new Date().toISOString(),
    },
    ...entries,
  ]);
}

export function removeBookFromLibrary(bookSlug: string) {
  writeLibrary(readLibrary().filter((entry) => entry.bookSlug !== bookSlug));
}

export function toggleBookInLibrary(bookSlug: string) {
  if (isBookInLibrary(bookSlug)) {
    removeBookFromLibrary(bookSlug);

    return false;
  }

  addBookToLibrary(bookSlug);

  return true;
}
