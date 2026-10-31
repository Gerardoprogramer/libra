import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { load } from "cheerio";

import en from "../messages/en.json";
import es from "../messages/es.json";
import { resolveStreamedSegments } from "./lib/streamed-html";

const input = process.argv.slice(2).find((argument) => argument !== "--") ?? "http://localhost:3000";
const base = new URL(input);
assert.ok(
  base.protocol === "https:" ||
    (base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)),
);
assert.ok(!base.username && !base.password && base.pathname === "/" && !base.search && !base.hash);

// Head-only assertions model a crawler that cannot process streamed metadata.
async function request(path: string, agent = "Twitterbot/1.0") {
  const target = new URL(path, base);
  // Canonical URLs refer to production; keep local tests on the selected server.
  const response = await fetch(new URL(`${target.pathname}${target.search}`, base), {
    headers: { "User-Agent": agent },
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200, `${target.pathname}: HTTP ${response.status}`);
  return response;
}

function assertPng(bytes: Buffer, width: number, height: number) {
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG signature");
  assert.equal(bytes.readUInt32BE(16), width, "PNG width");
  assert.equal(bytes.readUInt32BE(20), height, "PNG height");
}

async function main() {
  const sitemap = load(await (await request("/sitemap.xml")).text(), { xmlMode: true });
  const urls = sitemap("url > loc")
    .map((_, element) => sitemap(element).text())
    .get();
  assert.ok(urls.length > 0, "Configure SITE_URL and publish at least one edition before running this check.");
  assert.equal(new Set(urls).size, urls.length, "Duplicate sitemap URLs");
  const canonicalOrigin = new URL(urls[0]).origin;
  assert.ok(
    urls.every(
      (url) =>
        new URL(url).origin === canonicalOrigin &&
        !/\/(?:api|library)(?:\/|$)|\/(es|en)\/\1(?:\/|$)/.test(new URL(url).pathname),
    ),
  );
  const robots = await (await request("/robots.txt")).text();
  assert.ok(robots.includes(`Sitemap: ${canonicalOrigin}/sitemap.xml`));
  assert.ok(!/Disallow:.*(_next|icons|opengraph)/.test(robots));

  const samples: string[] = [];
  for (const locale of ["es", "en"]) {
    const matches = urls.filter((url) => new RegExp(`^/${locale}/books/[^/]+$`).test(new URL(url).pathname));
    assert.ok(matches.length, `No published ${locale} books in the sitemap`);
    samples.push(...matches.slice(0, 2).map((url) => new URL(url).pathname));
  }
  const imageHashes = new Set<string>();
  const imageUrls = new Set<string>();
  const icons = new Set<string>();
  const pageRoutes = ["/es", "/en", "/es/books", "/en/books", ...samples];

  for (const path of pageRoutes) {
    const received = await (await request(path)).text();
    const html = load(received);
    const locale = path.split("/")[1];
    assert.equal(html("html").attr("lang"), locale);
    const head = html("head");
    assert.equal(head.find('link[rel="canonical"]').length, 1, `${path}: canonical count`);
    assert.equal(head.find('link[rel="canonical"]').attr("href"), `${canonicalOrigin}${path}`);
    const meta = (name: string) => head.find(`meta[property="${name}"], meta[name="${name}"]`).attr("content");
    for (const name of [
      "description",
      "og:title",
      "og:description",
      "og:image",
      "og:image:alt",
      "twitter:title",
      "twitter:description",
      "twitter:image:alt",
    ]) {
      assert.ok(meta(name), `${path}: missing ${name} in head`);
    }
    assert.equal(meta("og:url"), `${canonicalOrigin}${path}`);
    assert.equal(meta("og:locale"), locale === "es" ? "es_ES" : "en_US");
    assert.equal(meta("og:site_name"), "Libra");
    assert.equal(meta("og:image:width"), "1200");
    assert.equal(meta("og:image:height"), "630");
    assert.equal(meta("twitter:card"), "summary_large_image");
    assert.equal(meta("twitter:image"), meta("og:image"));
    assert.equal(meta("twitter:image:alt"), meta("og:image:alt"));
    assert.equal(new URL(meta("og:image")!).origin, canonicalOrigin);

    const isBook = /^\/(es|en)\/books\/[^/]+$/.test(path);
    const expectedAlternates = ["es", "en"].filter((language) =>
      urls.includes(`${canonicalOrigin}${path.replace(/^\/(es|en)/, `/${language}`)}`),
    );
    const alternates = head.find('link[rel="alternate"][hreflang]');
    assert.equal(alternates.length, isBook && expectedAlternates.length === 1 ? 0 : expectedAlternates.length);
    alternates.each((_, element) => {
      const language = html(element).attr("hreflang")!;
      assert.equal(html(element).attr("href"), `${canonicalOrigin}${path.replace(/^\/(es|en)/, `/${language}`)}`);
      assert.ok(urls.includes(html(element).attr("href")!));
    });

    head.find('link[rel="icon"], link[rel="apple-touch-icon"]').each((_, element) => {
      icons.add(html(element).attr("href")!);
    });
    assert.ok(head.find('link[rel="manifest"]').attr("href")?.endsWith("/manifest.webmanifest"));

    if (isBook) {
      assert.equal(meta("og:type"), "book");
      const scripts = html('script[type="application/ld+json"]').toArray();
      const graph = scripts.flatMap((element) => {
        const data = JSON.parse(html(element).text()) as { "@graph"?: Record<string, unknown>[] };
        return data["@graph"] ?? [];
      });
      const book = graph.find((entry) => entry["@type"] === "Book");
      const page = graph.find((entry) => entry["@type"] === "WebPage");
      const breadcrumbs = graph.find((entry) => entry["@type"] === "BreadcrumbList");
      assert.ok(book && page && breadcrumbs, `${path}: missing structured data`);
      assert.equal(book.name, html("h1").text());
      assert.equal(book.url, `${canonicalOrigin}${path}`);
      assert.equal(page.inLanguage, locale);
      assert.ok(meta("og:title")?.includes(String(book.name)));
      // The title is readable in the initial HTML, without running any script.
      assert.equal(html("main h1").text(), book.name, `${path}: title in the initial main`);
      // A crawler render streams late parts of the page into hidden divs at the end of the body, which inline
      // scripts move into place. Read the page as laid out, and require every streamed part to have found its place.
      const { $: laidOut } = resolveStreamedSegments(received);
      assert.equal(laidOut('div[hidden][id^="S:"]').length, 0, `${path}: a streamed segment has no placeholder`);
      if (book.description) {
        const description = String(book.description);
        // Shown once, as the page's synopsis inside main: not merely somewhere in the document.
        const synopsis = laidOut('main [aria-labelledby="book-synopsis"] p');
        assert.equal(synopsis.length, 1, `${path}: synopsis count in main`);
        assert.equal(synopsis.text(), description, `${path}: the synopsis is the structured description`);
        assert.equal(laidOut("main").text().split(description).length, 2, `${path}: the synopsis appears once in main`);
        // The meta descriptions come from it (whole or cut with an ellipsis), never from the generic template.
        const metaDescription = meta("description")!;
        assert.ok(description.startsWith(metaDescription.replace(/…$/, "")), `${path}: meta description`);
        assert.equal(meta("og:description"), metaDescription, `${path}: og:description`);
        assert.equal(meta("twitter:description"), metaDescription, `${path}: twitter:description`);
      }
      if (book.image) {
        const cover = new URL(html("main img").first().attr("src")!, base);
        assert.equal(cover.searchParams.get("url") ?? cover.href, book.image);
        assert.ok(html("main img").first().attr("alt"));
      }
      const crumbs = breadcrumbs.itemListElement as { position: number; name: string; item: string }[];
      assert.deepEqual(
        crumbs.map(({ name }) => name),
        [locale === "es" ? "Inicio" : "Home", locale === "es" ? "Libros" : "Books", book.name],
      );
      assert.deepEqual(
        crumbs.map(({ position }) => position),
        [1, 2, 3],
      );
      assert.equal(crumbs[2].item, book.url);
      assert.equal(html('nav [aria-current="page"]').text(), book.name);
      imageUrls.add(meta("og:image")!);
    }

    const imageResponse = await request(meta("og:image")!);
    assert.ok(imageResponse.headers.get("content-type")?.includes("image/png"));
    assert.equal(imageResponse.headers.has("set-cookie"), false, "Image responses must not set locale cookies");
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    assertPng(bytes, 1200, 630);
    assert.ok(bytes.length < 5 * 1024 * 1024, "Social PNG must stay below 5 MB");
    if (isBook) imageHashes.add(createHash("sha256").update(bytes).digest("hex"));
    console.log(
      `PASS ${path}: head, canonical, alternates, ${isBook ? "JSON-LD, " : ""}OG PNG (${bytes.length} bytes)`,
    );
  }
  assert.equal(imageUrls.size, samples.length);
  assert.equal(imageHashes.size, samples.length, "Books must have different image bytes");

  const original = samples.find((path) => {
    const alternate = path.startsWith("/en/") ? path.replace("/en/", "/es/") : path.replace("/es/", "/en/");
    return !urls.includes(`${canonicalOrigin}${alternate}`);
  });
  if (original) {
    const alternate = original.startsWith("/en/") ? original.replace("/en/", "/es/") : original.replace("/es/", "/en/");
    const html = load(await (await request(alternate)).text());
    assert.equal(html('head link[rel="canonical"]').attr("href"), `${canonicalOrigin}${alternate}`);
    assert.ok(html('head meta[name="robots"]').attr("content")?.includes("noindex"));
    assert.equal(html("head link[hreflang]").length, 0);
    assert.equal(html('head meta[property="og:type"]').attr("content"), "book");
    assert.ok(html('script[type="application/ld+json"]').length);
    console.log(`PASS ${alternate}: fallback edition, own canonical, noindex and no invented hreflang`);
  }

  // Browsers may receive metadata after the initial head. Check the completed
  // document here; the crawler checks below still require it in the head.
  for (const path of ["/es/books", "/en/books", ...samples]) {
    const html = load(await (await request(path, "Mozilla/5.0")).text());
    assert.equal(html("html").attr("lang"), path.split("/")[1]);
    assert.ok(html("main h1").text(), `${path}: missing browser page content`);
    assert.ok(html("title").text(), `${path}: missing browser title`);
    assert.equal(html('link[rel="canonical"]').attr("href"), `${canonicalOrigin}${path}`);
    assert.equal(html('meta[property="og:image"]').length, 1, `${path}: browser OG image count`);
    console.log(`PASS browser ${path}: content and completed metadata`);
  }

  const path = samples[0];
  for (const agent of [
    "Googlebot",
    "WhatsApp/2.0",
    "facebookexternalhit/1.1",
    "Discordbot/2.0",
    "TelegramBot",
    "TelegramBot (like TwitterBot)",
    "Twitterbot/1.0",
    "LinkedInBot/1.0",
  ]) {
    const html = load(await (await request(path, agent)).text());
    assert.equal(html('head meta[property="og:image"]').length, 1, `${agent}: OG image must appear once in head`);
    assert.equal(html('head meta[name="twitter:card"]').attr("content"), "summary_large_image");
    console.log(`PASS crawler ${agent}`);
  }

  for (const icon of icons) {
    const response = await request(icon);
    assert.ok(response.headers.get("content-type")?.startsWith("image/"));
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  assert.ok([...icons].some((url) => url.includes("favicon.ico")));
  assert.ok([...icons].some((url) => url.includes("apple-icon")));
  assert.ok([...icons].some((url) => url.includes("icon.svg")));
  const manifest = (await (await request("/manifest.webmanifest")).json()) as {
    icons: { src: string; sizes: string }[];
    start_url: string;
  };
  assert.equal(manifest.start_url, "/");
  for (const icon of manifest.icons) {
    const [width, height] = icon.sizes.split("x").map(Number);
    assertPng(Buffer.from(await (await request(icon.src)).arrayBuffer()), width, height);
  }
  const missingPath = "/en/books/libra-seo-missing-book-0f7b16";
  const missingPage = await fetch(new URL(missingPath, base), { signal: AbortSignal.timeout(30_000) });
  // Cache Components may stream the shell as 200 before notFound resolves.
  // Next.js marks this documented soft 404 with noindex, which may stream for
  // this non-bot request. It must have no book entity or canonical. Image
  // Route Handlers must still return a real 404.
  assert.ok([200, 404].includes(missingPage.status), "Unexpected missing-page status");
  const missingHtml = load(await missingPage.text());
  assert.ok(
    missingHtml('meta[name="robots"]')
      .toArray()
      .some((element) =>
        missingHtml(element)
          .attr("content")
          ?.split(/\s*,\s*/)
          .includes("noindex"),
      ),
    "Missing books must be explicitly excluded from indexing",
  );
  assert.equal(missingHtml('link[rel="canonical"]').length, 0);
  assert.equal(missingHtml('script[type="application/ld+json"]').length, 0);
  const missingImage = await fetch(new URL(`${missingPath}/opengraph-image`, base), {
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(missingImage.status, 404, "Missing book images must return 404");

  // These are decided before anything streams, so unlike the missing book above they are real 404s: an unmatched
  // localized URL (rendered by src/app/global-not-found.tsx) and a chapter that exists in no public edition of a book.
  const unmatched = await fetch(new URL("/es/libra-seo-missing-route-0f7b16", base), {
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(unmatched.status, 404, "An unmatched localized URL must return 404");
  assert.equal(load(await unmatched.text())("html").attr("lang"), "es", "The 404 must render in the locale layout");

  const missingChapter = await fetch(new URL(`${samples[0]}/libra-seo-missing-chapter-0f7b16`, base), {
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(missingChapter.status, 404, "A chapter that does not exist must return 404");

  // The unmatched-URL 404 must be a complete localized document in the initial response, without waiting for
  // hydration, and a 404 must not carry a robots directive that contradicts noindex.
  const robotsTokens = (html: ReturnType<typeof load>) =>
    html('meta[name="robots"]')
      .toArray()
      .flatMap((element) => (html(element).attr("content") ?? "").split(/\s*,\s*/));
  const notFoundCopy = { es: es.errors, en: en.errors };
  for (const locale of ["es", "en"] as const) {
    const copy = notFoundCopy[locale];
    const response = await fetch(new URL(`/${locale}/libra-seo-missing-route-0f7b16`, base), {
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(response.status, 404, `/${locale}: an unmatched URL must return 404`);
    const html = load(await response.text());
    assert.equal(html("html").attr("lang"), locale, `/${locale}: 404 language`);
    assert.equal(html("html").attr("id"), undefined, `/${locale}: the generic Next.js error shell must not be served`);
    assert.equal(html("title").text(), `${copy.notFoundTitle} — Libra`, `/${locale}: 404 title`);
    assert.equal(html("main h1").text(), copy.notFoundTitle, `/${locale}: 404 heading in the initial HTML`);
    assert.ok(html("main").text().includes(copy.notFoundDescription), `/${locale}: 404 message in the initial HTML`);
    assert.ok(robotsTokens(html).includes("noindex"), `/${locale}: 404 must be noindex`);
    assert.ok(!robotsTokens(html).includes("index"), `/${locale}: 404 robots directives must not contradict noindex`);

    const chapterSample = samples.find((sample) => sample.startsWith(`/${locale}/`));
    assert.ok(chapterSample, `No ${locale} book sample for the chapter 404`);
    const chapter = await fetch(new URL(`${chapterSample}/libra-seo-missing-chapter-0f7b16`, base), {
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(chapter.status, 404, `/${locale}: a missing chapter must return 404`);
    const chapterHtml = load(await chapter.text());
    assert.equal(chapterHtml("html").attr("lang"), locale, `/${locale}: missing chapter language`);
    assert.ok(robotsTokens(chapterHtml).includes("noindex"), `/${locale}: missing chapter must be noindex`);
    assert.ok(!robotsTokens(chapterHtml).includes("index"), `/${locale}: missing chapter robots must not contradict`);
  }

  // No route handler owns /api/*: an unknown path is the same HTML 404 as any other unmatched URL, not a JSON API.
  const unknownApi = await fetch(new URL("/api/libra-seo-missing-route-0f7b16", base), {
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(unknownApi.status, 404, "An unknown /api path must return 404");
  const unmatchedWithoutLocale = await fetch(new URL("/libra-seo-missing-route-0f7b16", base), {
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(unmatchedWithoutLocale.status, 307, "A URL without a locale redirects to the default locale first");
  assert.ok(
    unmatchedWithoutLocale.headers.get("location")?.endsWith("/es/libra-seo-missing-route-0f7b16"),
    "Unexpected locale redirect",
  );
  console.log(
    "PASS sitemap, robots, crawler HTML, distinct images, icons, manifest, missing-page noindex, real 404s and image 404",
  );

  await checkCatalogFilters(urls, canonicalOrigin, robotsTokens);
}

const googlebot = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

// Category pages are the filtered catalog (/books?category=…): their own canonical and hreflang, listed in the sitemap.
// A search is never indexed, and a category that does not exist is a real 404 for browsers and crawlers alike.
async function checkCatalogFilters(
  urls: string[],
  canonicalOrigin: string,
  robotsTokens: (html: ReturnType<typeof load>) => string[],
) {
  const categoryUrls = urls.filter((url) => new URL(url).searchParams.has("category"));
  assert.ok(categoryUrls.length, "No category pages in the sitemap");
  assert.ok(
    urls.every((url) => !new URL(url).searchParams.has("q")),
    "Searches must not be in the sitemap",
  );

  for (const locale of ["es", "en"]) {
    const url = categoryUrls.find((item) => new URL(item).pathname === `/${locale}/books`);
    assert.ok(url, `No ${locale} category in the sitemap`);
    const target = new URL(url);
    const html = load(await (await request(`${target.pathname}${target.search}`, googlebot)).text());
    assert.equal(html('head link[rel="canonical"]').attr("href"), url, `${url}: canonical keeps the category`);
    assert.equal(html(`head link[hreflang="${locale}"]`).attr("href"), url, `${url}: hreflang names itself`);
    assert.ok(!robotsTokens(html).includes("noindex"), `${url}: a category is indexable`);
    console.log(`PASS ${target.pathname}${target.search}: own canonical, hreflang and indexable`);
  }

  const category = new URL(categoryUrls[0]).searchParams.get("category");
  for (const search of ["?q=dracula", `?q=dracula&category=${category}`]) {
    const html = load(await (await request(`/es/books${search}`, googlebot)).text());
    assert.deepEqual(robotsTokens(html), ["noindex", "follow"], `${search}: a search is noindex, follow`);
    assert.equal(html('link[rel="canonical"]').length, 0, `${search}: a search has no canonical`);
    assert.equal(html("link[hreflang]").length, 0, `${search}: a search has no hreflang`);
    console.log(`PASS /es/books${search}: noindex, follow without canonical or hreflang`);
  }

  // A missing category is only a real 404 for HTML-limited bots such as Googlebot, which get a blocking render. A
  // browser receives the prerendered shell first, so the status is already 200 when the page reaches notFound(): a
  // known limitation of the architecture (docs/seo.md, "Categorías inexistentes"), checked as such and never reported
  // as a 404. Both get the same not-found head. Every failure is collected, so one run reports each URL and agent.
  const failures: string[] = [];
  const notFoundTitles = { es: `${es.errors.notFoundTitle} — Libra`, en: `${en.errors.notFoundTitle} — Libra` };
  for (const path of ["/es/books?category=x", "/en/books?category=Adventure"]) {
    const locale = path.split("/")[1] as "es" | "en";
    for (const [agent, userAgent, expectedStatus] of [
      ["Googlebot", googlebot, 404],
      ["browser", "Mozilla/5.0", 200],
    ] as const) {
      const response = await fetch(new URL(path, base), {
        headers: { "User-Agent": userAgent },
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      const html = load(await response.text());
      const tokens = robotsTokens(html);
      const googlebotTokens = html('meta[name="googlebot"]')
        .toArray()
        .flatMap((element) => (html(element).attr("content") ?? "").split(/\s*,\s*/));
      const titles = html("title")
        .toArray()
        .map((element) => html(element).text());
      const problems = [
        response.status !== expectedStatus && `HTTP ${response.status}, expected ${expectedStatus}`,
        !(tokens.includes("noindex") && tokens.includes("follow")) &&
          `robots ${JSON.stringify(tokens)}, not noindex, follow`,
        (tokens.includes("index") || googlebotTokens.includes("index")) && "an `index` directive contradicts noindex",
        html('link[rel="canonical"]').length > 0 && `canonical ${html('link[rel="canonical"]').attr("href")}`,
        (titles.length === 0 || titles.some((title) => title !== notFoundTitles[locale])) &&
          `title ${JSON.stringify(titles)}`,
      ].filter(Boolean);
      if (problems.length) failures.push(`${path} (${agent}): ${problems.join("; ")}`);
      else if (expectedStatus === 404) {
        console.log(`PASS ${path} (${agent}): HTTP 404, not-found title, noindex, follow, no canonical`);
      } else {
        console.log(
          `KNOWN LIMITATION ${path} (${agent}): HTTP 200, not a 404 (streamed prerendered shell); ` +
            "the head is still the not-found title, noindex, follow and no canonical",
        );
      }
    }
  }
  assert.deepEqual(failures, [], `A missing category must get the not-found head:\n${failures.join("\n")}`);
  console.log(
    `PASS catalog filters: categories, searches and the missing-category head; HTTP 404 for Googlebot only ` +
      `(canonical origin ${canonicalOrigin})`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
