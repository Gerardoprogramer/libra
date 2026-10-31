import type { MetadataRoute } from "next";

import type { ContentLocale } from "@/db/queries/books";
import { getCatalogCategoryPath } from "@/lib/catalog-filters";

const locales: ContentLocale[] = ["en", "es"];
const staticPaths = ["/", "/books", "/authors", "/categories"];

function getLocalizedUrl(siteUrl: URL, locale: ContentLocale, pathname: string) {
  const path = pathname === "/" ? "" : pathname;

  return new URL(`/${locale}${path}`, siteUrl).href;
}

export function createPublicSitemap(
  siteUrl: URL | null,
  content: {
    books: readonly {
      slug: string;
      locales: readonly ContentLocale[];
    }[];
    chapters: readonly {
      bookSlug: string;
      slug: string;
      locale: ContentLocale;
    }[];
    authorSlugs: readonly string[];
    categories?: readonly {
      slug: string;
      locales: readonly ContentLocale[];
    }[];
  },
): MetadataRoute.Sitemap {
  if (!siteUrl) {
    return [];
  }

  const localizedEntries = new Map<string, MetadataRoute.Sitemap[number]>();

  const authorPaths = content.authorSlugs.map((slug) => `/authors/${encodeURIComponent(slug)}`);

  for (const pathname of [...staticPaths, ...authorPaths]) {
    const languages = Object.fromEntries(locales.map((locale) => [locale, getLocalizedUrl(siteUrl, locale, pathname)]));

    for (const locale of locales) {
      const url = languages[locale];

      localizedEntries.set(url, {
        url,
        alternates: { languages },
      });
    }
  }

  for (const book of content.books) {
    const languages = Object.fromEntries(
      book.locales.map((locale) => [
        locale,
        getLocalizedUrl(siteUrl, locale, `/books/${encodeURIComponent(book.slug)}`),
      ]),
    );

    for (const locale of book.locales) {
      const url = languages[locale];

      localizedEntries.set(url, {
        url,
        ...(book.locales.length > 1 ? { alternates: { languages } } : {}),
      });
    }
  }

  // A category is the filtered catalog (getCatalogCategoryPath), listed only in the locales it has a translated name in.
  for (const category of content.categories ?? []) {
    const languages = Object.fromEntries(
      category.locales.map((locale) => [
        locale,
        getLocalizedUrl(siteUrl, locale, getCatalogCategoryPath(category.slug)),
      ]),
    );

    for (const locale of category.locales) {
      const url = languages[locale];

      localizedEntries.set(url, {
        url,
        ...(category.locales.length > 1 ? { alternates: { languages } } : {}),
      });
    }
  }

  for (const chapter of content.chapters) {
    const url = getLocalizedUrl(
      siteUrl,
      chapter.locale,
      `/books/${encodeURIComponent(chapter.bookSlug)}/${encodeURIComponent(chapter.slug)}`,
    );

    localizedEntries.set(url, {
      url,
    });
  }

  return [...localizedEntries.values()];
}

export function createRobotsMetadata(siteUrl: URL | null): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/"],
    },
    ...(siteUrl ? { sitemap: new URL("/sitemap.xml", siteUrl).href } : {}),
  };
}
