// Covers made for Libra (scripts/covers/) are stored under their own prefix, covers/libra/, apart from the covers the
// importer takes from EPUBs (covers/<book slug>-<Gutenberg id>-<hash>.<ext>). The prefix is what tells a re-import to
// keep such a cover instead of restoring the EPUB's (buildImportDiff in import-plan.ts). Pure: no R2 client here.

export const CUSTOM_COVER_PREFIX = "covers/libra/";

/**
 * Whether a stored cover URL points at a cover made for Libra: its path ends in /covers/libra/<file>, under any public
 * base (the r2.dev domain, a custom domain, or a base with a path of its own).
 */
export function isCustomCoverUrl(url: string | null | undefined): boolean {
  if (!url) return false;

  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }

  return /\/covers\/libra\/[^/]+$/.test(pathname);
}
