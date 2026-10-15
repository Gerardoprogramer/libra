import assert from "node:assert/strict";
import { test } from "node:test";

import JSZip from "jszip";

import { parseEpub } from "./parse-epub";
import { planChapterReimport } from "./reimport-chapters";

// In-memory EPUBs only: these tests never invoke an importer, PostgreSQL or R2.
async function epub(metadata: string) {
  const zip = new JSZip();
  zip.file("META-INF/container.xml", '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>');
  zip.file(
    "book.opf",
    `<package xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <metadata>${metadata}</metadata>
    <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
    <spine><itemref idref="chapter"/></spine>
  </package>`,
  );
  zip.file(
    "chapter.xhtml",
    `<html><body><h1>Capítulo primero</h1><p>${"Una frase de prueba. ".repeat(30)}</p></body></html>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function twoSpineDocuments(secondHref = "chapter2.xhtml", includeSecond = false) {
  const zip = new JSZip();
  zip.file("META-INF/container.xml", '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>');
  zip.file(
    "book.opf",
    `<package xmlns:dc="http://purl.org/dc/elements/1.1/">
      <metadata><dc:title>Obra de prueba</dc:title><dc:language>es</dc:language></metadata>
      <manifest>
        <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
        <item id="chapter2" href="${secondHref}" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="chapter1"/><itemref idref="chapter2"/></spine>
    </package>`,
  );
  zip.file(
    "chapter1.xhtml",
    `<html><body><h1>CapÃ­tulo uno</h1><p>${"Texto de prueba. ".repeat(30)}</p></body></html>`,
  );
  if (includeSecond) {
    zip.file(
      "chapter2.xhtml",
      `<html><body><h1>CapÃ­tulo dos</h1><p>${"Segundo texto. ".repeat(30)}</p></body></html>`,
    );
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

const work = "<dc:title>Obra de prueba</dc:title><dc:language>es</dc:language>";

// Covers are recognized by their magic bytes, never by the media type the manifest declares.
const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

async function epubWithCover(coverBytes: Buffer, coverMediaType = "image/jpeg") {
  const zip = new JSZip();
  zip.file("META-INF/container.xml", '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>');
  zip.file(
    "book.opf",
    `<package xmlns:dc="http://purl.org/dc/elements/1.1/">
      <metadata><dc:title>Obra de prueba</dc:title><dc:language>es</dc:language></metadata>
      <manifest>
        <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
        <item id="cover" href="cover.img" media-type="${coverMediaType}" properties="cover-image"/>
      </manifest>
      <spine><itemref idref="chapter"/></spine>
    </package>`,
  );
  zip.file(
    "chapter.xhtml",
    `<html><body><h1>Capítulo primero</h1><p>${"Una frase de prueba. ".repeat(30)}</p></body></html>`,
  );
  zip.file("cover.img", coverBytes);
  return zip.generateAsync({ type: "nodebuffer" });
}

test("narrative prologues and epilogues are preserved in both languages", async () => {
  for (const titles of [
    ["Prologue", "Chapter One", "Epilogue"],
    ["Prólogo", "Capítulo primero", "Epílogo"],
  ]) {
    const zip = await JSZip.loadAsync(await epub(work));
    zip.file(
      "chapter.xhtml",
      `<html><body>${titles.map((title) => `<h1>${title}</h1><p>${`${title} is part of the narrative. `.repeat(30)}</p>`).join("")}</body></html>`,
    );
    const parsed = await parseEpub(await zip.generateAsync({ type: "nodebuffer" }));
    assert.deepEqual(
      parsed.chapters.map((chapter) => chapter.title),
      titles,
    );
  }
});

test("a complete EPUB preserves chapter content, word counts, navigation and its cover page exclusions", async () => {
  const zip = new JSZip();
  zip.file("META-INF/container.xml", '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>');
  zip.file(
    "book.opf",
    `<package xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:epub="http://www.idpf.org/2007/ops">
      <metadata><dc:title>Obra de prueba</dc:title><dc:language>es</dc:language></metadata>
      <manifest>
        <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
        <item id="cover-page" href="cover-page.xhtml" media-type="application/xhtml+xml"/>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="cover-image" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>
      </manifest>
      <spine><itemref idref="cover-page"/><itemref idref="nav"/><itemref idref="chapter"/></spine>
    </package>`,
  );
  const paragraph = "Narrative text remains in the chapter. ".repeat(30);
  zip.file(
    "chapter.xhtml",
    `<html><body><h1>Prologue</h1><p>${paragraph}</p><h1>Chapter One</h1><p>${paragraph}</p><h1>Epilogue</h1><p>${paragraph}</p></body></html>`,
  );
  zip.file("cover-page.xhtml", '<html><body><section epub:type="cover"><h1>Cover</h1></section></body></html>');
  zip.file("nav.xhtml", '<html><body><nav epub:type="toc"><h1>Contents</h1></nav></body></html>');
  zip.file("cover.jpg", jpegBytes);

  const parsed = await parseEpub(await zip.generateAsync({ type: "nodebuffer" }));
  assert.deepEqual(
    parsed.chapters.map(({ title }) => title),
    ["Prologue", "Chapter One", "Epilogue"],
  );
  for (const chapter of parsed.chapters) {
    assert.equal(chapter.content, paragraph.trim());
    assert.equal(chapter.wordCount, paragraph.trim().split(/\s+/).length);
  }
  assert.deepEqual(parsed.cover, {
    data: jpegBytes,
    mediaType: "image/jpeg",
    extension: "jpg",
  });
});

test("a declared spine reading document missing from the ZIP fails instead of returning partial chapters", async () => {
  await assert.rejects(
    parseEpub(await twoSpineDocuments()),
    /EPUB validation failed: spine document not found: chapter2\.xhtml/,
  );
});

test("a broken spine path reference fails with the idref and href", async () => {
  await assert.rejects(
    parseEpub(await twoSpineDocuments("%E0%A4%A.xhtml")),
    /EPUB validation failed: invalid spine reference: chapter2 -> %E0%A4%A\.xhtml/,
  );
});

test("legitimate non-reading spine resources and EPUB3 navigation remain excluded", async () => {
  const zip = await JSZip.loadAsync(await twoSpineDocuments("chapter2.xhtml", true));
  zip.file(
    "book.opf",
    `<package xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:epub="http://www.idpf.org/2007/ops">
      <metadata><dc:title>Obra de prueba</dc:title><dc:language>es</dc:language></metadata>
      <manifest>
        <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
        <item id="cover-page" href="cover-page.xhtml" media-type="application/xhtml+xml"/>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="image" href="illustration.jpg" media-type="image/jpeg"/>
      </manifest>
      <spine><itemref idref="chapter1"/><itemref idref="cover-page"/><itemref idref="nav"/><itemref idref="image"/></spine>
    </package>`,
  );
  zip.file("cover-page.xhtml", '<html><body><section epub:type="cover"><h1>Cover</h1></section></body></html>');
  zip.file("nav.xhtml", '<html><body><nav epub:type="toc"><h1>Contents</h1></nav></body></html>');
  zip.file("illustration.jpg", Buffer.from("illustration"));
  const parsed = await parseEpub(await zip.generateAsync({ type: "nodebuffer" }));
  assert.deepEqual(
    parsed.chapters.map(({ title }) => title),
    ["CapÃ­tulo uno"],
  );
});

test("an incomplete EPUB aborts before its chapter data can reach a destructive reimport plan", async () => {
  const existing = [
    {
      id: "chapter-2",
      number: 2,
      slug: "capitulo-dos",
      title: "CapÃ­tulo dos",
      content: "Existing chapter content",
      wordCount: 3,
    },
  ];
  let planReached = false;
  try {
    const parsed = await parseEpub(await twoSpineDocuments());
    planReached = true;
    planChapterReimport(existing, parsed.chapters, new Set());
  } catch (error) {
    assert.match(String(error), /spine document not found: chapter2\.xhtml/);
  }
  assert.equal(planReached, false);
});

test("generated duplicate suffixes cannot collide with literal chapter titles", async () => {
  const zip = await JSZip.loadAsync(await epub(work));
  zip.file(
    "chapter.xhtml",
    `<html><body>${["Arrival", "Arrival", "Arrival 2"].map((title, index) => `<h1>${title}</h1><p>${`Narrative ${index}. `.repeat(40)}</p>`).join("")}</body></html>`,
  );
  const parsed = await parseEpub(await zip.generateAsync({ type: "nodebuffer" }));
  assert.equal(parsed.chapters.length, 3);
  assert.equal(new Set(parsed.chapters.map((chapter) => chapter.slug)).size, 3);
});

test("EPUB authors are not attributed as translators when no translation role exists", async () => {
  const parsed = await parseEpub(await epub(`${work}<dc:creator>Autora de prueba</dc:creator>`));
  assert.deepEqual(parsed.creators, ["Autora de prueba"]);
  assert.equal(parsed.translator, null);
  assert.equal(parsed.language, "es");
  assert.equal(parsed.cover, null);
  assert.equal(parsed.chapters.length, 1);
  assert.equal(parsed.chapters[0].title, "Capítulo primero");
});

test("literal numeric titles are preserved and absent author metadata stays absent", async () => {
  const parsed = await parseEpub(await epub("<dc:title>001984</dc:title><dc:language>es</dc:language>"));
  assert.equal(parsed.title, "001984");
  assert.deepEqual(parsed.creators, []);
  assert.equal(parsed.translator, null);
});

test("EPUB2 translation roles on creators and contributors remain separate from authors", async () => {
  for (const tag of ["creator", "contributor"]) {
    const parsed = await parseEpub(
      await epub(`${work}
      <dc:creator opf:role="aut">Autora de prueba</dc:creator>
      <dc:${tag} opf:role="trl">Traductora de prueba</dc:${tag}>
      <dc:contributor opf:role="edt">Editor de prueba</dc:contributor>`),
    );
    assert.deepEqual(parsed.creators, ["Autora de prueba"]);
    assert.equal(parsed.translator, "Traductora de prueba");
  }
});

test("EPUB3 role refinements attribute multiple translators without adding them to authors", async () => {
  const parsed = await parseEpub(
    await epub(`${work}
    <dc:creator id="author">Autora de prueba</dc:creator>
    <meta refines="#author" property="role" scheme="marc:relators">aut</meta>
    <dc:creator id="translator-a">Traductora A</dc:creator>
    <meta refines="#translator-a" property="role" scheme="marc:relators">trl</meta>
    <dc:contributor id="translator-b">Traductor B</dc:contributor>
    <meta refines="#translator-b" property="role" scheme="marc:relators">trl</meta>`),
  );
  assert.deepEqual(parsed.creators, ["Autora de prueba"]);
  assert.equal(parsed.translator, "Traductora A, Traductor B");
});

test("missing, blank or ambiguous titles never become an invented Untitled work", async () => {
  for (const title of ["", "<dc:title> </dc:title>", "<dc:title>Uno</dc:title><dc:title>Dos</dc:title>"]) {
    await assert.rejects(parseEpub(await epub(`${title}<dc:language>es</dc:language>`)), /dc:title/);
  }
});

test("missing, blank, ambiguous or oversized languages never become English or a truncated tag", async () => {
  for (const language of [
    "",
    "<dc:language> </dc:language>",
    "<dc:language>es</dc:language><dc:language>en</dc:language>",
    "<dc:language>en-GB-oxendict</dc:language>",
  ]) {
    await assert.rejects(parseEpub(await epub(`<dc:title>Obra de prueba</dc:title>${language}`)), /dc:language/);
  }
  const parsed = await parseEpub(await epub("<dc:title>Obra de prueba</dc:title><dc:language>ES-MX</dc:language>"));
  assert.equal(parsed.language, "es-mx");
});

test("an EPUB date is not silently assigned as either the original year or the edition year", async () => {
  const parsed = await parseEpub(await epub(`${work}<dc:date>2026-10-01</dc:date>`));
  assert.equal("originalPublicationYear" in parsed, false);
  assert.equal("publicationYear" in parsed, false);
});

test("the extraction report is exposed so an importer can show what was kept and discarded", async () => {
  const parsed = await parseEpub(await epub(work));

  assert.equal(
    parsed.extraction.keptWords + parsed.extraction.discardedWords + parsed.extraction.leadingWords,
    parsed.extraction.totalWords,
  );
  assert.deepEqual(parsed.extraction.warnings, []);
});

test("a cover is identified by its bytes: a PNG declared as JPEG is stored as PNG", async () => {
  const parsed = await parseEpub(await epubWithCover(pngBytes, "image/jpeg"));

  assert.equal(parsed.cover?.mediaType, "image/png");
  assert.equal(parsed.cover?.extension, "png");
});

test("a cover that is not a JPEG, PNG or WebP image is ignored with a warning, never uploaded", async () => {
  for (const [bytes, declared] of [
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "image/svg+xml"],
    [Buffer.from("<html>not an image</html>"), "image/jpeg"],
    [Buffer.alloc(0), "image/png"],
  ] as const) {
    const parsed = await parseEpub(await epubWithCover(bytes, declared));

    assert.equal(parsed.cover, null);
    assert.match(parsed.extraction.warnings.join("\n"), /Cover ignored/);
  }
});

test("an oversized cover is ignored with a warning", async () => {
  const parsed = await parseEpub(await epubWithCover(Buffer.concat([jpegBytes, Buffer.alloc(2048)])), {
    maxCoverBytes: 1024,
  });

  assert.equal(parsed.cover, null);
  assert.match(parsed.extraction.warnings.join("\n"), /Cover ignored.*limit 1024/);
});

test("a ZIP entry that expands past the limit is rejected from its declared size, before inflating it", async () => {
  const zip = await JSZip.loadAsync(await epub(work));
  zip.file("padding.txt", Buffer.alloc(200_000), { compression: "DEFLATE" });
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

  assert.ok(buffer.length < 10_000, "the fixture compresses to a tiny archive");
  await assert.rejects(parseEpub(buffer, { maxEntryBytes: 100_000 }), /ZIP entry padding\.txt expands to 200000 bytes/);
  await assert.rejects(parseEpub(buffer, { maxTotalBytes: 100_000 }), /the archive expands to/);
  await assert.rejects(parseEpub(buffer, { maxEntries: 2 }), /ZIP entries exceed the limit/);
  await assert.rejects(parseEpub(buffer, { maxFileBytes: 100 }), /the file is \d+ bytes/);
});

test("malformed XHTML in a spine document is rejected rather than imported with partial text", async () => {
  const zip = await JSZip.loadAsync(await epub(work));
  zip.file("chapter.xhtml", "<html><body><h1>Capítulo</h1><p>Sin cerrar</body></html>");

  await assert.rejects(parseEpub(await zip.generateAsync({ type: "nodebuffer" })), /invalid XML in chapter\.xhtml/);
});

test("chapters keep the text of numbered subsections instead of losing it", async () => {
  const zip = await JSZip.loadAsync(await epub(work));
  const filler = (word: string) => `${word} `.repeat(40).trim();
  zip.file(
    "chapter.xhtml",
    `<html xmlns="http://www.w3.org/1999/xhtml"><body><h2>-I-</h2><h2>Un caballero</h2><h2>-i-</h2><p>${filler("primera")}</p><h2>-ii-</h2><p>${filler("segunda")}</p><h2>-II-</h2><h2>Otro</h2><p>${filler("tercera")}</p></body></html>`,
  );
  const parsed = await parseEpub(await zip.generateAsync({ type: "nodebuffer" }));

  assert.deepEqual(
    parsed.chapters.map((chapter) => chapter.title),
    ["-I- Un caballero", "-II- Otro"],
  );
  assert.match(parsed.chapters[0].content, /primera[\s\S]*segunda/);
  assert.equal(parsed.extraction.mergedSubsections, 1);
});
