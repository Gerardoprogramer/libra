import "server-only";

import type { Metadata } from "next";

import type { ContentLocale } from "@/db/queries/books";

type OpenGraphImages = NonNullable<Metadata["openGraph"]>["images"];

function getSiteUrl(): URL | null {
  const configuredUrl = process.env.SITE_URL?.trim();

  if (!configuredUrl) {
    return null;
  }

  let siteUrl: URL;

  try {
    siteUrl = new URL(configuredUrl);
  } catch {
    throw new Error("SITE_URL must be an absolute HTTPS origin.");
  }

  const isLocalHttp =
    process.env.NODE_ENV !== "production" &&
    siteUrl.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(siteUrl.hostname);

  if (
    (siteUrl.protocol !== "https:" && !isLocalHttp) ||
    siteUrl.username ||
    siteUrl.password ||
    siteUrl.pathname !== "/" ||
    siteUrl.search ||
    siteUrl.hash
  ) {
    throw new Error("SITE_URL must be an HTTPS origin without credentials, path, query or fragment.");
  }

  return new URL(siteUrl.origin);
}

function getRouteUrl(siteUrl: URL, locale: ContentLocale, pathname: string) {
  const path = pathname === "/" ? "" : pathname.startsWith("/") ? pathname : `/${pathname}`;

  return new URL(`/${locale}${path}`, siteUrl);
}

export function createLocalizedMetadata({
  locale,
  pathname,
  title,
  description,
  robots,
  images,
}: {
  locale: ContentLocale;
  pathname: string;
  title: string;
  description?: string;
  robots?: Metadata["robots"];
  images?: OpenGraphImages;
}): Metadata {
  const siteUrl = getSiteUrl();
  const isIndexable = typeof robots !== "object" || robots === null || robots.index !== false;
  const canonical = siteUrl && isIndexable ? getRouteUrl(siteUrl, locale, pathname) : undefined;
  const languages =
    siteUrl && isIndexable
      ? {
          en: getRouteUrl(siteUrl, "en", pathname),
          es: getRouteUrl(siteUrl, "es", pathname),
        }
      : undefined;

  return {
    title,
    description,
    ...(robots ? { robots } : {}),
    ...(canonical && languages ? { alternates: { canonical, languages } } : {}),
    openGraph: {
      title,
      ...(description ? { description } : {}),
      ...(canonical ? { url: canonical } : {}),
      siteName: "Libra",
      locale: locale === "es" ? "es_ES" : "en_US",
      type: "website",
      ...(images ? { images } : {}),
    },
    twitter: {
      card: "summary",
      title,
      ...(description ? { description } : {}),
      ...(images ? { images } : {}),
    },
  };
}
