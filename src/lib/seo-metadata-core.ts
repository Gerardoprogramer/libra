import type { Metadata } from "next";

import type { ContentLocale } from "@/db/queries/books";
import { getAbsolutePublicImageUrl, getConfiguredSiteUrl } from "@/lib/site-url";
import { getDefaultSocialImage, type SocialImage } from "@/lib/social-metadata";

function getRouteUrl(siteUrl: URL, locale: ContentLocale, pathname: string) {
  const path = pathname === "/" ? "" : pathname.startsWith("/") ? pathname : `/${pathname}`;

  return new URL(`/${locale}${path}`, siteUrl);
}

function getSocialImages(images?: SocialImage[]) {
  return images?.flatMap(({ url, ...image }) => {
    const absoluteUrl = getAbsolutePublicImageUrl(String(url));

    return absoluteUrl ? [{ ...image, url: absoluteUrl }] : [];
  });
}

export function createLocalizedMetadata({
  locale,
  pathname,
  title,
  description,
  robots,
  images,
  canonical: includeCanonical,
  bookAuthors,
  alternateLocales = ["en", "es"],
}: {
  locale: ContentLocale;
  pathname: string;
  title: string;
  description?: string;
  robots?: Metadata["robots"];
  images?: SocialImage[];
  canonical?: boolean;
  bookAuthors?: string[];
  alternateLocales?: ContentLocale[] | false;
}): Metadata {
  const siteUrl = getConfiguredSiteUrl();
  const socialImages = getSocialImages(images ?? getDefaultSocialImage(locale));
  const isIndexable = typeof robots !== "object" || robots === null || robots.index !== false;
  const canonical = siteUrl && (includeCanonical ?? isIndexable) ? getRouteUrl(siteUrl, locale, pathname) : undefined;
  const languages =
    siteUrl && isIndexable && alternateLocales
      ? Object.fromEntries(
          alternateLocales.map((alternateLocale) => [
            alternateLocale,
            getRouteUrl(siteUrl, alternateLocale, pathname).href,
          ]),
        )
      : undefined;
  const alternates = canonical
    ? {
        canonical,
        ...(languages && Object.keys(languages).length > 0 ? { languages } : {}),
      }
    : undefined;

  return {
    title,
    description,
    ...(robots ? { robots } : {}),
    ...(alternates ? { alternates } : {}),
    openGraph: {
      title,
      ...(description ? { description } : {}),
      ...(canonical ? { url: canonical } : {}),
      siteName: "Libra",
      locale: locale === "es" ? "es_ES" : "en_US",
      ...(bookAuthors ? { type: "book", authors: bookAuthors } : { type: "website" }),
      ...(socialImages && socialImages.length > 0 ? { images: socialImages } : {}),
    },
    twitter: {
      card: socialImages && socialImages.length > 0 ? "summary_large_image" : "summary",
      title,
      ...(description ? { description } : {}),
      ...(socialImages && socialImages.length > 0 ? { images: socialImages } : {}),
    },
  };
}
