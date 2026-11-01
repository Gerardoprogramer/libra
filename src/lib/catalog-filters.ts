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

/** Books per catalog page. Changing it only changes which books each page holds; no URL depends on it. */
export const CATALOG_PAGE_SIZE = 30;

// One to four digits without a leading zero: page 1 to 9999. Bounded, so it never makes an unbounded cache key.
const pagePattern = /^[1-9]\d{0,3}$/;

/**
 * The catalog page named by ?page=. Absent is page 1; anything else must be one plain number in range. Arrays (a
 * repeated parameter), zero, negatives, decimals, text and leading zeros are null: a page that does not exist.
 */
export function parseCatalogPage(value: unknown): number | null {
  if (value === undefined) return 1;

  return typeof value === "string" && pagePattern.test(value) ? Number(value) : null;
}

/**
 * A catalog URL without the locale prefix. The parameters always come in the same order (category, q, page) and page 1
 * is never written, so each listing has exactly one URL: the one its canonical, hreflang and links use.
 */
export function getCatalogPath({ category, query, page = 1 }: { category?: string; query?: string; page?: number }) {
  const parameters = new URLSearchParams();

  if (category) parameters.set("category", category);
  if (query) parameters.set("q", query);
  if (page > 1) parameters.set("page", String(page));

  const search = parameters.toString();

  return search ? `/books?${search}` : "/books";
}

/** The catalog filtered by one category, without the locale prefix: its canonical, hreflang and sitemap path. */
export function getCatalogCategoryPath(slug: string): string {
  return getCatalogPath({ category: slug });
}

/** Makes `%`, `_` and the escape character itself match literally in a LIKE/ILIKE pattern. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function containsPattern(value: string): string {
  return `%${escapeLikePattern(value)}%`;
}
