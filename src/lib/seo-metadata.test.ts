import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { createLocalizedMetadata } from "./seo-metadata-core";
import { getBookSocialImage } from "./social-metadata";

const originalSiteUrl = process.env.SITE_URL;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = originalSiteUrl;
  if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
  else Reflect.set(process.env, "NODE_ENV", originalNodeEnv);
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
  assert.equal(typeof metadata.alternates?.languages?.en, "string");
  assert.equal(typeof metadata.alternates?.languages?.es, "string");
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

test("pages without a verified translated route keep their canonical but omit hreflang", () => {
  process.env.SITE_URL = "https://libra.example";

  const metadata = createLocalizedMetadata({
    locale: "es",
    pathname: "/books/dracula/chapter-one",
    title: "Capítulo I — Drácula",
    alternateLocales: false,
  });

  assert.equal(String(metadata.alternates?.canonical), "https://libra.example/es/books/dracula/chapter-one");
  assert.equal(metadata.alternates && "languages" in metadata.alternates, false);
});

test("social images must be absolute and secure in production and select the large Twitter card", () => {
  process.env.SITE_URL = "https://libra.example";
  Reflect.set(process.env, "NODE_ENV", "production");

  const metadata = createLocalizedMetadata({
    locale: "en",
    pathname: "/books/dracula",
    title: "Dracula",
    images: [
      { url: "https://covers.example/dracula.jpg", alt: "Cover" },
      { url: "/internal/r2-key.jpg", alt: "Relative path" },
      { url: "http://covers.example/insecure.jpg", alt: "Insecure" },
      { url: "https://user:password@covers.example/credential.jpg", alt: "Credentials" },
      { url: "https://covers.example/dracula.jpg?token=secret", alt: "Signed URL" },
    ],
  });

  assert.deepEqual(metadata.openGraph?.images, [{ url: "https://covers.example/dracula.jpg", alt: "Cover" }]);
  assert.equal(
    metadata.twitter && "card" in metadata.twitter ? metadata.twitter.card : undefined,
    "summary_large_image",
  );
  assert.deepEqual(metadata.twitter?.images, [{ url: "https://covers.example/dracula.jpg", alt: "Cover" }]);
});

test("metadata without a valid cover does not invent a social image", () => {
  process.env.SITE_URL = "https://libra.example";
  Reflect.set(process.env, "NODE_ENV", "production");

  const metadata = createLocalizedMetadata({
    locale: "es",
    pathname: "/books/book-without-cover",
    title: "Libro sin portada",
    images: [{ url: "/covers/missing.jpg" }],
  });

  assert.equal(metadata.openGraph?.images, undefined);
  assert.equal(metadata.twitter?.images, undefined);
  assert.equal(metadata.twitter && "card" in metadata.twitter ? metadata.twitter.card : undefined, "summary");
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

test("book previews reuse the same 1200x630 PNG for Open Graph and Twitter in each interface locale", () => {
  process.env.SITE_URL = "https://www.alyvenor.com";

  for (const locale of ["en", "es"] as const) {
    const metadata = createLocalizedMetadata({
      locale,
      pathname: "/books/dracula",
      title: "Dracula — Bram Stoker",
      images: getBookSocialImage(locale, "dracula", "Dracula", "Bram Stoker"),
      bookAuthors: [`https://www.alyvenor.com/${locale}/authors/bram-stoker`],
    });
    assert.equal(metadata.openGraph && "type" in metadata.openGraph ? metadata.openGraph.type : undefined, "book");
    assert.deepEqual(metadata.openGraph?.images, [
      {
        url: `https://www.alyvenor.com/${locale}/books/dracula/opengraph-image`,
        alt: "Dracula — Bram Stoker | Libra",
        width: 1200,
        height: 630,
        type: "image/png",
      },
    ]);
    assert.deepEqual(metadata.twitter?.images, metadata.openGraph?.images);
  }
});

test("fallback editions can be shared with their own canonical without inventing a translation", () => {
  process.env.SITE_URL = "https://www.alyvenor.com";
  const metadata = createLocalizedMetadata({
    locale: "es",
    pathname: "/books/dracula",
    title: "Dracula",
    robots: { index: false, follow: true },
    alternateLocales: false,
    canonical: true,
  });
  assert.equal(String(metadata.alternates?.canonical), "https://www.alyvenor.com/es/books/dracula");
  assert.equal(metadata.alternates?.languages, undefined);
  assert.deepEqual(metadata.robots, { index: false, follow: true });
});

test("public indexes have localized branded previews without depending on a book cover", () => {
  process.env.SITE_URL = "https://www.alyvenor.com";
  const metadata = createLocalizedMetadata({ locale: "es", pathname: "/books", title: "Libros" });
  assert.deepEqual(metadata.openGraph?.images, [
    {
      url: "https://www.alyvenor.com/es/opengraph-image",
      alt: "Libra — Una biblioteca sin fronteras",
      width: 1200,
      height: 630,
      type: "image/png",
    },
  ]);
});
