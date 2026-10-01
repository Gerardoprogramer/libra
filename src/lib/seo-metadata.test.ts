import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { createLocalizedMetadata } from "./seo-metadata-core";

const originalSiteUrl = process.env.SITE_URL;

afterEach(() => {
  if (originalSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = originalSiteUrl;
});

test("English metadata preserves provided editorial content and emits localized canonical and alternates", () => {
  process.env.SITE_URL = "https://libra.example";

  const metadata = createLocalizedMetadata({
    locale: "en",
    pathname: "/books/dracula",
    title: "Dracula — Bram Stoker",
    description: "A real description from the edition.",
    images: [{ url: "https://covers.example/dracula.jpg", alt: "Dracula cover" }],
  });

  assert.equal(metadata.title, "Dracula — Bram Stoker");
  assert.equal(metadata.description, "A real description from the edition.");
  assert.equal(String(metadata.alternates?.canonical), "https://libra.example/en/books/dracula");
  assert.equal(String(metadata.alternates?.languages?.en), "https://libra.example/en/books/dracula");
  assert.equal(String(metadata.alternates?.languages?.es), "https://libra.example/es/books/dracula");
  assert.equal(metadata.openGraph?.locale, "en_US");
  assert.equal(String(metadata.openGraph?.url), "https://libra.example/en/books/dracula");
  assert.deepEqual(metadata.openGraph?.images, [{ url: "https://covers.example/dracula.jpg", alt: "Dracula cover" }]);
});

test("Spanish metadata uses the Spanish canonical URL, locale, and the given author title", () => {
  process.env.SITE_URL = "https://libra.example";

  const metadata = createLocalizedMetadata({
    locale: "es",
    pathname: "/authors/mary-shelley",
    title: "Mary Shelley — Libra",
  });

  assert.equal(metadata.title, "Mary Shelley — Libra");
  assert.equal(metadata.description, undefined);
  assert.equal(String(metadata.alternates?.canonical), "https://libra.example/es/authors/mary-shelley");
  assert.equal(String(metadata.alternates?.languages?.en), "https://libra.example/en/authors/mary-shelley");
  assert.equal(String(metadata.alternates?.languages?.es), "https://libra.example/es/authors/mary-shelley");
  assert.equal(metadata.openGraph?.locale, "es_ES");
  assert.equal(metadata.twitter?.description, undefined);
});

test("metadata remains localized but omits absolute URLs when SITE_URL is not configured", () => {
  delete process.env.SITE_URL;

  const metadata = createLocalizedMetadata({
    locale: "es",
    pathname: "/",
    title: "Libra — Una biblioteca sin fronteras",
    description: "Descripción editorial localizada.",
  });

  assert.equal(metadata.title, "Libra — Una biblioteca sin fronteras");
  assert.equal(metadata.description, "Descripción editorial localizada.");
  assert.equal(metadata.alternates, undefined);
  assert.equal(metadata.openGraph?.url, undefined);
  assert.equal(metadata.openGraph?.locale, "es_ES");
});

test("noindex pages do not receive canonical or hreflang metadata", () => {
  process.env.SITE_URL = "https://libra.example";

  const metadata = createLocalizedMetadata({
    locale: "en",
    pathname: "/books/missing",
    title: "Book not found — Libra",
    robots: { index: false, follow: true },
  });

  assert.deepEqual(metadata.robots, { index: false, follow: true });
  assert.equal(metadata.alternates, undefined);
  assert.equal(metadata.openGraph?.url, undefined);
});

test("SITE_URL rejects credentials, paths, query strings, fragments, and insecure remote origins", () => {
  for (const siteUrl of [
    "not an absolute URL",
    "https://user:password@libra.example",
    "https://libra.example/path",
    "https://libra.example?preview=true",
    "https://libra.example#fragment",
    "http://libra.example",
  ]) {
    process.env.SITE_URL = siteUrl;
    assert.throws(() => createLocalizedMetadata({ locale: "en", pathname: "/", title: "Libra" }), /SITE_URL/);
  }
});
