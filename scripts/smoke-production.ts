import { XMLParser, XMLValidator } from "fast-xml-parser";

const requiredSecurityHeaders: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "SAMEORIGIN",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getBaseUrl(): URL {
  const input = process.argv[2] ?? "http://localhost:3000";
  const url = new URL(input);
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Base URL must be an HTTPS origin, or a localhost HTTP origin, without path or credentials.");
  }

  return url;
}

async function checkRoute(baseUrl: URL, pathname: string, expectedContentType: string): Promise<string> {
  const response = await fetch(new URL(pathname, baseUrl), {
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`${pathname} returned HTTP ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes(expectedContentType)) {
    throw new Error(`${pathname} returned unexpected content type: ${contentType || "missing"}.`);
  }

  for (const [name, expectedValue] of Object.entries(requiredSecurityHeaders)) {
    if (response.headers.get(name)?.toLowerCase() !== expectedValue.toLowerCase()) {
      throw new Error(`${pathname} is missing the expected ${name} response header.`);
    }
  }

  const permissionsPolicy = response.headers.get("permissions-policy") ?? "";

  if (!permissionsPolicy.includes("camera=()") || !permissionsPolicy.includes("microphone=()")) {
    throw new Error(`${pathname} is missing the expected Permissions-Policy response header.`);
  }

  console.log(`PASS ${pathname} (${response.status})`);

  return response.text();
}

function getPublishedBookPath(sitemapXml: string): string {
  if (XMLValidator.validate(sitemapXml) !== true) {
    throw new Error("/sitemap.xml is not valid XML.");
  }

  const parsed: unknown = new XMLParser().parse(sitemapXml);

  if (!isRecord(parsed) || !isRecord(parsed.urlset)) {
    throw new Error("/sitemap.xml does not contain a URL set.");
  }

  const rawEntries = parsed.urlset.url;
  const entries = Array.isArray(rawEntries) ? rawEntries : rawEntries === undefined ? [] : [rawEntries];

  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.loc !== "string") {
      continue;
    }

    let url: URL;

    try {
      url = new URL(entry.loc);
    } catch {
      continue;
    }

    const bookRoute = /^\/en\/books\/([^/]+)$/.exec(url.pathname);

    if (url.protocol === "https:" && bookRoute) {
      return `/en/books/${bookRoute[1]}`;
    }
  }

  throw new Error("Sitemap has no published English book route; verify SITE_URL and the published catalog.");
}

async function main() {
  const baseUrl = getBaseUrl();
  const routes = [
    "/",
    "/es",
    "/en",
    "/es/books",
    "/en/books",
    "/es/authors",
    "/en/authors",
    "/es/categories",
    "/en/categories",
  ];

  for (const route of routes) {
    await checkRoute(baseUrl, route, "text/html");
  }

  const sitemap = await checkRoute(baseUrl, "/sitemap.xml", "application/xml");
  const robots = await checkRoute(baseUrl, "/robots.txt", "text/plain");

  if (!robots.includes("/sitemap.xml")) {
    throw new Error("/robots.txt does not reference the sitemap.");
  }

  await checkRoute(baseUrl, getPublishedBookPath(sitemap), "text/html");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Production smoke test failed.");
  process.exitCode = 1;
});
