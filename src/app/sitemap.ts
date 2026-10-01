import type { MetadataRoute } from "next";

import { getSitemapContent } from "@/db/queries/books";
import { createPublicSitemap } from "@/lib/public-index";
import { getConfiguredSiteUrl } from "@/lib/site-url";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getConfiguredSiteUrl();

  if (!siteUrl) {
    return [];
  }

  const content = await getSitemapContent();

  return createPublicSitemap(siteUrl, content);
}
