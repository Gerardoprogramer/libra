import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { load } from "cheerio";

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
    const html = load(await (await request(path)).text());
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
      if (book.description) assert.ok(html("main").text().includes(String(book.description)));
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
  console.log(
    "PASS sitemap, robots, crawler HTML, distinct images, icons, manifest, missing-page noindex and image 404",
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
