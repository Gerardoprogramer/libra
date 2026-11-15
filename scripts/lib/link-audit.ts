// Pure parts of `pnpm smoke:links` (scripts/smoke-links.ts): which kind of page a path is, which anchors of a page are
// internal links, whether a response tells search engines not to index it, and the count of links to such pages.

import { load } from "cheerio";

export type SourceKind = "home" | "catalog" | "book" | "reader" | "authors" | "categories" | "other";
export type TargetKind = "book" | "chapter" | "other";

const LOCALE = "(?:es|en)";

/** The kind of public page a pathname is, as a source of links. */
export function sourceKind(pathname: string): SourceKind {
  if (new RegExp(`^/${LOCALE}$`).test(pathname)) return "home";
  if (new RegExp(`^/${LOCALE}/books$`).test(pathname)) return "catalog";
  if (new RegExp(`^/${LOCALE}/books/[^/]+$`).test(pathname)) return "book";
  if (new RegExp(`^/${LOCALE}/books/[^/]+/[^/]+$`).test(pathname)) return "reader";
  if (new RegExp(`^/${LOCALE}/authors(?:/[^/]+)?$`).test(pathname)) return "authors";
  if (new RegExp(`^/${LOCALE}/categories$`).test(pathname)) return "categories";
  return "other";
}

/** The kind of page a link points to: a book page, a chapter of the reader, or anything else. */
export function targetKind(pathname: string): TargetKind {
  const kind = sourceKind(pathname);
  if (kind === "book") return "book";
  if (kind === "reader") return "chapter";
  return "other";
}

/** Paths that are not pages to audit: API routes, framework assets, auth callbacks and generated images. */
function isAuditablePath(pathname: string) {
  return (
    !/^\/(?:api|_next|_vercel|auth)(?:\/|$)/.test(pathname) &&
    !/\/opengraph-image$/.test(pathname) &&
    !/\.[a-z0-9]+$/i.test(pathname)
  );
}

/**
 * The internal links of a page, as `pathname + search` (no fragment), in document order and without repeats. An
 * anchor counts once per page: a crawler discovers a URL, not how many times it is written.
 */
export function internalLinks(html: string, pageUrl: URL): string[] {
  const $ = load(html);
  const links = new Set<string>();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;

    let target: URL;
    try {
      target = new URL(href, pageUrl);
    } catch {
      return;
    }

    if (target.origin !== pageUrl.origin || !isAuditablePath(target.pathname)) return;
    links.add(`${target.pathname}${target.search}`);
  });

  return Array.from(links);
}

/** Whether a page asks not to be indexed: a robots or googlebot meta tag, or an X-Robots-Tag header. */
export function isNoindex(html: string, robotsHeader: string | null): boolean {
  if (robotsHeader && /\bnoindex\b/i.test(robotsHeader)) return true;

  const $ = load(html);

  return $('meta[name="robots"], meta[name="googlebot"]')
    .map((_, element) => $(element).attr("content") ?? "")
    .get()
    .some((content) => /\bnoindex\b/i.test(content));
}

export interface LinkEdge {
  /** pathname + search of the page that holds the link. */
  source: string;
  /** pathname + search of the page linked. */
  target: string;
}

export interface NoindexLinkSummary {
  /** Links (one per source page and target) whose target is noindex. */
  total: number;
  /** Distinct noindex URLs that receive at least one link. */
  distinctTargets: number;
  byTarget: Record<TargetKind, number>;
  bySource: Record<SourceKind, number>;
  /** [source kind][target kind] → links. */
  matrix: Record<SourceKind, Record<TargetKind, number>>;
}

export const SOURCE_KINDS: SourceKind[] = ["catalog", "book", "reader", "authors", "categories", "home", "other"];
export const TARGET_KINDS: TargetKind[] = ["book", "chapter", "other"];

function pathnameOf(pathAndSearch: string) {
  return new URL(pathAndSearch, "http://audit.invalid").pathname;
}

export function summarizeNoindexLinks(edges: readonly LinkEdge[], noindex: ReadonlySet<string>): NoindexLinkSummary {
  const byTarget = Object.fromEntries(TARGET_KINDS.map((kind) => [kind, 0])) as Record<TargetKind, number>;
  const bySource = Object.fromEntries(SOURCE_KINDS.map((kind) => [kind, 0])) as Record<SourceKind, number>;
  const matrix = Object.fromEntries(
    SOURCE_KINDS.map((kind) => [kind, Object.fromEntries(TARGET_KINDS.map((target) => [target, 0]))]),
  ) as Record<SourceKind, Record<TargetKind, number>>;
  const targets = new Set<string>();
  let total = 0;

  for (const edge of edges) {
    if (!noindex.has(edge.target)) continue;
    const source = sourceKind(pathnameOf(edge.source));
    const target = targetKind(pathnameOf(edge.target));
    total++;
    byTarget[target]++;
    bySource[source]++;
    matrix[source][target]++;
    targets.add(edge.target);
  }

  return { total, distinctTargets: targets.size, byTarget, bySource, matrix };
}
