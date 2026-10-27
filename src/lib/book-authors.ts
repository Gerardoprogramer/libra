import en from "../../messages/en.json";
import es from "../../messages/es.json";

// A work with no known author (an anonymous classic) has no authors rows: it is shown with the anonymous label of the
// interface language, never with an invented author record or an /authors link.
const ANONYMOUS_AUTHOR = { es: es.book.anonymousAuthor, en: en.book.anonymousAuthor } as const;

/** The author line of a work: its authors in order, or the anonymous label when it has none. */
export function formatAuthorNames(names: readonly string[], locale: keyof typeof ANONYMOUS_AUTHOR) {
  return names.length > 0 ? names.join(", ") : ANONYMOUS_AUTHOR[locale];
}
