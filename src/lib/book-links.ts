import type { Locale } from "@/i18n/routing";

// Every internal link to a book page or a chapter is built here, so that a book is linked under the locale of the
// text it shows. The page of a book under the other locale still exists and can be shared, but it shows the same
// edition and is `noindex` (docs/seo.md): linking it would send crawlers to a page they cannot index.

export interface BookLinkTarget {
  slug: string;
  /**
   * Language of the edition the book shows in the interface locale without `?edition=`: what `chooseEdition` selects
   * (BookListItem.language, BookDetails.edition.language). It differs from the interface locale only when the book has
   * no public edition in that locale, because `chooseEdition` prefers the edition of the requested locale.
   */
  editionLanguage: string;
  chapterSlug?: string;
  /** A pinned edition, kept as `?edition=`. It does not change the locale of the link. */
  editionId?: string;
}

export interface BookLink {
  /** Path without the locale prefix, for the `Link` and router of `@/i18n/navigation`. */
  href: string;
  /** Locale to pass with `href`. */
  locale: Locale;
}

function contentLocale(language: string): Locale | null {
  const code = language.toLowerCase().split("-")[0];

  return code === "en" || code === "es" ? code : null;
}

/**
 * The locale a book is linked under. A book with an edition in the interface locale stays in it (a book with editions
 * in both languages, for instance). A book shown in another language is linked under that language, where its page is
 * indexable. A language that is not a locale of the site keeps the interface locale.
 */
export function bookLinkLocale(editionLanguage: string, interfaceLocale: Locale): Locale {
  return contentLocale(editionLanguage) ?? interfaceLocale;
}

/** Path of a book page or chapter, without the locale prefix. */
export function bookPath(slug: string, chapterSlug?: string, editionId?: string) {
  const book = `/books/${encodeURIComponent(slug)}`;
  const path = chapterSlug ? `${book}/${encodeURIComponent(chapterSlug)}` : book;

  return editionId ? `${path}?edition=${encodeURIComponent(editionId)}` : path;
}

/** The link to a book page (no `chapterSlug`) or to one of its chapters. */
export function bookLink(target: BookLinkTarget, interfaceLocale: Locale): BookLink {
  return {
    href: bookPath(target.slug, target.chapterSlug, target.editionId),
    locale: bookLinkLocale(target.editionLanguage, interfaceLocale),
  };
}
