import assert from "node:assert/strict";
import { test } from "node:test";

import JSZip from "jszip";

import { parseEpub } from "./parse-epub";

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

const work = "<dc:title>Obra de prueba</dc:title><dc:language>es</dc:language>";

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
