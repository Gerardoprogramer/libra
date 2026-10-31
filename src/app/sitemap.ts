import type { MetadataRoute } from "next";

import { getCategories, getSitemapContent } from "@/db/queries/books";
import { createPublicSitemap } from "@/lib/public-index";
import { getConfiguredSiteUrl } from "@/lib/site-url";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getConfiguredSiteUrl();

  if (!siteUrl) {
    return [];
  }

  // The slug is shared by every locale and getCategories lists only categories with public books, so the names'
  // locale does not matter here.
  const [content, categories] = await Promise.all([getSitemapContent(), getCategories("en")]);

  return createPublicSitemap(siteUrl, {
    ...content,
    categories: categories.map(({ slug, locales }) => ({ slug, locales })),
  });
}
