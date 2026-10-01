import type { MetadataRoute } from "next";

import type { ContentLocale } from "@/db/queries/books";

const locales: ContentLocale[] = ["en", "es"];
const staticPaths = ["/", "/books", "/authors", "/categories"];

function getLocalizedUrl(siteUrl: URL, locale: ContentLocale, pathname: string) {
  const path = pathname === "/" ? "" : pathname;

  return new URL(`/${locale}${path}`, siteUrl).href;
}

export function createPublicSitemap(
  siteUrl: URL | null,
  content: { bookSlugs: readonly string[]; authorSlugs: readonly string[] },
): MetadataRoute.Sitemap {
  if (!siteUrl) {
    return [];
  }

  const localizedEntries = new Map<string, MetadataRoute.Sitemap[number]>();
  const paths = [
    ...staticPaths,
    ...content.bookSlugs.map((slug) => `/books/${encodeURIComponent(slug)}`),
    ...content.authorSlugs.map((slug) => `/authors/${encodeURIComponent(slug)}`),
  ];

  for (const pathname of new Set(paths)) {
    const languages = Object.fromEntries(locales.map((locale) => [locale, getLocalizedUrl(siteUrl, locale, pathname)]));

    for (const locale of locales) {
      const url = languages[locale];
      localizedEntries.set(url, {
        url,
        alternates: { languages },
      });
    }
  }

  return [...localizedEntries.values()];
}

export function createRobotsMetadata(siteUrl: URL | null): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/library", "/en/library", "/es/library"],
    },
    ...(siteUrl ? { sitemap: new URL("/sitemap.xml", siteUrl).href } : {}),
  };
}
