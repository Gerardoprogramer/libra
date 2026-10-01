import assert from "node:assert/strict";
import { test } from "node:test";

import { createPublicSitemap, createRobotsMetadata } from "./public-index";

test("sitemap includes localized public indexes and unique book and author routes", () => {
  const sitemap = createPublicSitemap(new URL("https://libra.example"), {
    bookSlugs: ["dracula", "frankenstein", "dracula"],
    authorSlugs: ["mary-shelley"],
  });
  const urls = sitemap.map(({ url }) => url);

  assert.equal(urls.length, 14);
  for (const locale of ["en", "es"]) {
    for (const path of [
      "/",
      "/books",
      "/authors",
      "/categories",
      "/books/dracula",
      "/books/frankenstein",
      "/authors/mary-shelley",
    ]) {
      assert.ok(urls.includes(`https://libra.example/${locale}${path === "/" ? "" : path}`));
    }
  }
  assert.equal(new Set(urls).size, urls.length);
});

test("sitemap emits reciprocal language alternates only for configured locales", () => {
  const sitemap = createPublicSitemap(new URL("https://libra.example"), {
    bookSlugs: ["dracula"],
    authorSlugs: ["mary-shelley"],
  });
  const entry = sitemap.find(({ url }) => url === "https://libra.example/es/books/dracula");

  assert.deepEqual(entry?.alternates?.languages, {
    en: "https://libra.example/en/books/dracula",
    es: "https://libra.example/es/books/dracula",
  });
});

test("sitemap is empty when SITE_URL is not configured", () => {
  assert.deepEqual(createPublicSitemap(null, { bookSlugs: ["dracula"], authorSlugs: ["mary-shelley"] }), []);
});

test("sitemap excludes user libraries, readers, endpoints, and non-public routes", () => {
  const sitemap = createPublicSitemap(new URL("https://libra.example"), {
    bookSlugs: ["dracula"],
    authorSlugs: ["mary-shelley"],
  });
  const urls = sitemap.map(({ url }) => url);

  assert.ok(urls.every((url) => url.startsWith("https://")));
  assert.ok(urls.every((url) => !url.includes("/library")));
  assert.ok(urls.every((url) => !url.includes("/api/")));
  assert.ok(urls.every((url) => !url.includes("/chapter")));
  assert.ok(urls.every((url) => !url.includes("?")));
});

test("robots allows public pages and disallows local libraries and API endpoints", () => {
  const robots = createRobotsMetadata(new URL("https://libra.example"));
  const rules = robots.rules as { allow?: string; disallow?: string[] };

  assert.equal(rules.allow, "/");
  assert.deepEqual(rules.disallow, ["/api/", "/library", "/en/library", "/es/library"]);
  assert.equal(robots.sitemap, "https://libra.example/sitemap.xml");
});

test("robots remains useful in development without SITE_URL and does not block render assets", () => {
  const robots = createRobotsMetadata(null);
  const rules = robots.rules as { allow?: string; disallow?: string[] };

  assert.equal(rules.allow, "/");
  assert.equal(robots.sitemap, undefined);
  assert.ok(!rules.disallow?.some((path) => path.includes("_next")));
});
