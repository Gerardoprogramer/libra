// Request-controlled values reach cached queries, where each distinct argument creates a cache entry, and
// ILIKE patterns, where % and _ are wildcards. They are normalized before either happens.

export const MAX_SEARCH_LENGTH = 100;
export const MAX_CATEGORY_LENGTH = 80;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Stored slugs are lowercase words joined by single hyphens (accented letters are kept by the Spanish editions).
const slugPattern = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;

/** True for a string that can name a stored book or chapter slug; anything else never reaches a cache key. */
export function isSlug(value: unknown): value is string {
  return typeof value === "string" && value.length <= 300 && slugPattern.test(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

/** Single-string search parameter: control characters removed, whitespace collapsed, length bounded. */
export function normalizeSearchQuery(value: unknown): string {
  if (typeof value !== "string") return "";

  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEARCH_LENGTH)
    .trim();
}

export function normalizeCategorySlug(value: unknown): string {
  if (typeof value !== "string") return "";

  return value.trim().slice(0, MAX_CATEGORY_LENGTH);
}

/** The catalog filtered by one category, without the locale prefix: its canonical, hreflang and sitemap path. */
export function getCatalogCategoryPath(slug: string): string {
  return `/books?category=${encodeURIComponent(slug)}`;
}

/** Makes `%`, `_` and the escape character itself match literally in a LIKE/ILIKE pattern. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function containsPattern(value: string): string {
  return `%${escapeLikePattern(value)}%`;
}
