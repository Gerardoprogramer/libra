export function getConfiguredSiteUrl(): URL | null {
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

export function getAbsolutePublicImageUrl(value: string): string | null {
  let imageUrl: URL;

  try {
    imageUrl = new URL(value);
  } catch {
    return null;
  }

  const isLocalHttp =
    process.env.NODE_ENV !== "production" &&
    imageUrl.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(imageUrl.hostname);

  if (
    (imageUrl.protocol !== "https:" && !isLocalHttp) ||
    imageUrl.username ||
    imageUrl.password ||
    imageUrl.search ||
    imageUrl.hash
  ) {
    return null;
  }

  return imageUrl.href;
}
