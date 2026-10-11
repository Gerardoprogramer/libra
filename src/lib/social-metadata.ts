import type { Locale } from "@/i18n/routing";
import { getConfiguredSiteUrl } from "@/lib/site-url";

export const socialImageSize = { width: 1200, height: 630 };

export interface SocialImage {
  url: string | URL;
  alt?: string;
  width?: number;
  height?: number;
  type?: string;
}

function imageAt(pathname: string, alt: string): SocialImage[] | undefined {
  const siteUrl = getConfiguredSiteUrl();

  return siteUrl ? [{ url: new URL(pathname, siteUrl), alt, ...socialImageSize, type: "image/png" }] : undefined;
}

export function getDefaultSocialImage(locale: Locale) {
  return imageAt(
    `/${locale}/opengraph-image`,
    locale === "es" ? "Libra — Una biblioteca sin fronteras" : "Libra — A library without walls",
  );
}

export function getBookSocialImage(locale: Locale, slug: string, title: string, authors: string) {
  return imageAt(
    `/${locale}/books/${encodeURIComponent(slug)}/opengraph-image`,
    `${title}${authors ? ` — ${authors}` : ""} | Libra`,
  );
}
