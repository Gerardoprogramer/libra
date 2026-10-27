import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";

import { calculateBookProgress } from "../../src/lib/reading-progress";

import { parseEpub } from "./parse-epub";
import { remapReadingPosition } from "./reimport-chapters";

const importsDirectory = path.join(fileURLToPath(new URL("../../", import.meta.url)), "imports");
const available = fs.existsSync(importsDirectory);

const words = (value: string) => value.split(/\s+/).filter(Boolean).length;

// Chapter count and total words of the catalogue EPUBs, measured with the parser that produced the editions
// published so far (HEAD before the Fortunata fix). Fortunata is the only book whose text was supposed to change.
// Since chapters gained typed blocks two more changed on purpose: Pride and Prejudice gets back the 59 drop capitals
// drawn as images (121555 -> 121557 words: "A FEW days" and "“I hope" add one-letter words), and the Wizard of Oz no
// longer repeats 21 p.caption2 captions as paragraphs (39311 -> 39132); epub-corpus-baseline.json has the detail.
const pinned: Record<string, { chapters: number; words: number }> = {
  "a-christmas-carol.epub": { chapters: 5, words: 28421 },
  "adventures-of-sherlock-holmes.epub": { chapters: 12, words: 105893 },
  "alice-in-wonderland.epub": { chapters: 12, words: 26371 },
  "dracula.epub": { chapters: 27, words: 159796 },
  "fortunata-y-jacinta-17013.epub": { chapters: 31, words: 392840 },
  "frankenstein.epub": { chapters: 28, words: 74919 },
  "jekyll-and-hyde.epub": { chapters: 10, words: 25530 },
  "la-isla-del-tesoro.epub": { chapters: 35, words: 88259 },
  "marianela-17340.epub": { chapters: 22, words: 50432 },
  "moby-dick.epub": { chapters: 136, words: 208275 },
  "pride-and-prejudice.epub": { chapters: 61, words: 121557 },
  "the-picture-of-dorian-gray.epub": { chapters: 20, words: 78505 },
  "the-time-machine.epub": { chapters: 17, words: 32311 },
  "the-war-of-the-worlds.epub": { chapters: 27, words: 59738 },
  "the-wonderful-wizard-of-oz.epub": { chapters: 24, words: 39132 },
  "treasure-island.epub": { chapters: 34, words: 67655 },
};

for (const [file, expected] of Object.entries(pinned)) {
  test(
    `REVIEW: ${file} keeps its pinned structure, order and text with no duplicated passages`,
    {
      skip:
        !available || !fs.existsSync(path.join(importsDirectory, file))
          ? "EPUB not present (imports/ is untracked)"
          : false,
    },
    async () => {
      const epub = await parseEpub(fs.readFileSync(path.join(importsDirectory, file)));

      assert.equal(epub.chapters.length, expected.chapters);
      assert.equal(words(epub.chapters.map((chapter) => chapter.content).join("\n")), expected.words);
      assert.deepEqual(
        epub.chapters.map((chapter) => chapter.number),
        epub.chapters.map((_, index) => index + 1),
        "chapters are numbered 1..n in reading order",
      );
      assert.equal(new Set(epub.chapters.map((chapter) => chapter.slug)).size, epub.chapters.length, "unique slugs");

      const paragraphs = epub.chapters
        .flatMap((chapter) => chapter.content.split(/\n\s*\n/))
        .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
        .filter((paragraph) => paragraph.length > 200);
      assert.equal(new Set(paragraphs).size, paragraphs.length, "no long paragraph appears twice");

      const { extraction } = epub;
      assert.equal(
        extraction.keptWords + extraction.discardedWords + extraction.leadingWords,
        extraction.totalWords,
        "every readable word is kept, reported as discarded, or reported as leading text",
      );
    },
  );
}

test(
  "REVIEW: Fortunata y Jacinta keeps its four parts, every numbered subsection and its reading order",
  {
    skip: !fs.existsSync(path.join(importsDirectory, "fortunata-y-jacinta-17013.epub")) ? "EPUB not present" : false,
  },
  async () => {
    const epub = await parseEpub(fs.readFileSync(path.join(importsDirectory, "fortunata-y-jacinta-17013.epub")));

    // Part I has 11 chapters, II 7, III 7 and IV 6: the roman numeral restarts at each part.
    const numerals = epub.chapters.map((chapter) => /^-([IVXL]+)-/.exec(chapter.title)?.[1]);
    assert.ok(numerals.every(Boolean), "every chapter keeps its roman numeral");
    const restarts = numerals.flatMap((numeral, index) => (numeral === "I" ? [index] : []));
    assert.deepEqual(restarts, [0, 11, 18, 25], "four parts of 11, 7, 7 and 6 chapters");
    assert.equal(epub.chapters.length, 31);

    assert.equal(epub.extraction.mergedSubsections, 167, "numbered subsections are continued inside their chapters");
    assert.ok(epub.extraction.discardedWords < 200, "only title pages, dividers and the licence are discarded");
    assert.deepEqual(epub.extraction.warnings, []);

    const text = epub.chapters.map((chapter) => chapter.content).join("\n");
    assert.ok(words(text) > 390_000, "the whole novel, not only the first subsection of each chapter");
    // First and last sentences of the novel.
    assert.match(epub.chapters[0].content, /^-i-\s+Las noticias más remotas que tengo de la persona/);
    assert.match(epub.chapters.at(-1)!.content, /Fortunata sintió ruido en la puerta/);
    assert.equal(epub.chapters.at(-1)!.title, "-VI- Final");
    // Each chapter's "-II-"-style marker is part of the next title; it must not also end the previous chapter.
    for (const chapter of epub.chapters) {
      assert.doesNotMatch(chapter.content.split(/\n\n/).at(-1)!, /^-[IVXL]+-$/, chapter.title);
    }
  },
);

const fortunata = () => path.join(importsDirectory, "fortunata-y-jacinta-17013.epub");
const paragraphsOf = (content: string) =>
  content
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .filter(Boolean);

test(
  "REVIEW: the closing lines of each part stay at the end of its last chapter and nowhere else",
  { skip: !fs.existsSync(fortunata()) ? "EPUB not present" : false },
  async () => {
    const epub = await parseEpub(fs.readFileSync(fortunata()));
    const closings = new Map([
      [11, ["Madrid.—Enero de 1886.", "FIN DE LA PRIMERA PARTE"]],
      [18, ["Madrid.—Mayo de 1886.", "FIN DE LA PARTE SEGUNDA"]],
      [25, ["Madrid.—Diciembre de 1886.", "FIN DE LA PARTE TERCERA"]],
      [31, ["Madrid.—Junio de 1887.", "FIN DE LA NOVELA"]],
    ]);

    assert.equal(epub.extraction.closingLines, 8);
    for (const chapter of epub.chapters) {
      const expected = closings.get(chapter.number);
      const paragraphs = paragraphsOf(chapter.content);

      if (expected) assert.deepEqual(paragraphs.slice(-2), expected, `chapter ${chapter.number} ends with its closing`);
      else assert.ok(!paragraphs.some((p) => /^FIN DE LA /.test(p)), `chapter ${chapter.number} has no closing`);
      assert.ok(!/FIN DE LA|Madrid\.—/.test(chapter.title), "closing lines never enter a title");
    }
    assert.equal(epub.chapters.length, 31, "no chapter was created for them");
  },
);

// Paragraph counts of the chapters currently stored in production (read-only query of 2026-10-15): each holds only
// the text before its first "-ii-" subsection.
const storedParagraphs = [
  10, 9, 10, 23, 23, 10, 12, 9, 17, 48, 33, 17, 16, 30, 16, 10, 12, 19, 10, 24, 54, 51, 8, 49, 59, 29, 42, 29, 33, 14,
  29,
];

test(
  "REVIEW: saved positions stay on the same paragraph and get a percentage that matches the longer chapter",
  { skip: !fs.existsSync(fortunata()) ? "EPUB not present" : false },
  async () => {
    const epub = await parseEpub(fs.readFileSync(fortunata()));
    let largest = { chapter: 0, factor: 0 };

    for (const chapter of epub.chapters) {
      const next = paragraphsOf(chapter.content);
      const firstSplit = next.indexOf("-ii-");
      // The stored text is the chapter up to its second subsection (or all of it when it has none).
      const old = (firstSplit < 0 ? next : next.slice(0, firstSplit)).join("\n\n");
      const oldParagraphs = paragraphsOf(old);
      assert.equal(oldParagraphs.length, storedParagraphs[chapter.number - 1], `chapter ${chapter.number} as stored`);

      const words = (value: string) => value.split(/\s+/).filter(Boolean).length;
      const factor = words(chapter.content) / words(old);
      if (factor > largest.factor) largest = { chapter: chapter.number, factor };

      const last = oldParagraphs.length - 1;
      const cases = [
        { name: "start", saved: { paragraphIndex: 0, percentage: 0 } },
        { name: "middle", saved: { paragraphIndex: Math.floor(last / 2), percentage: 50 } },
        { name: "end of the previous text", saved: { paragraphIndex: last, percentage: 100 } },
      ];
      let previousPercentage = -1;

      for (const { name, saved } of cases) {
        const moved = remapReadingPosition(old, chapter.content, saved);
        const label = `chapter ${chapter.number}, ${name}`;

        assert.equal(moved.paragraphIndex, saved.paragraphIndex, `${label}: same paragraph`);
        assert.equal(next[moved.paragraphIndex], oldParagraphs[saved.paragraphIndex], `${label}: same text`);
        assert.ok(Number.isInteger(moved.percentage) && moved.percentage >= 0 && moved.percentage <= 100, label);
        assert.ok(moved.percentage >= previousPercentage, `${label}: later positions never show less progress`);
        previousPercentage = moved.percentage;

        // The book figure the reader sees moves with it and stays within the chapter's share of the book.
        const book = (percentage: number) =>
          calculateBookProgress({
            bookSlug: "fortunata-y-jacinta",
            chapterSlug: chapter.slug,
            chapterTitle: chapter.title,
            chapterNumber: chapter.number,
            percentage,
            chapterIndex: chapter.number - 1,
            totalChapters: epub.chapters.length,
            updatedAt: "2026-01-01T00:00:00.000Z",
          });
        assert.ok(book(moved.percentage) >= Math.floor(((chapter.number - 1) / 31) * 100), label);
        assert.ok(book(moved.percentage) <= Math.ceil((chapter.number / 31) * 100), label);
      }

      // Words before the paragraph / words of the chapter: the end of the old text is far from 100 %.
      const end = remapReadingPosition(old, chapter.content, { paragraphIndex: last, percentage: 100 });
      if (factor > 1.5) assert.ok(end.percentage < 100, `chapter ${chapter.number} no longer reads 100 %`);
    }

    // The most enlarged chapter: the reader who had "finished" it is now near its start, not at 100 %.
    const grown = epub.chapters[largest.chapter - 1];
    const grownOld = paragraphsOf(grown.content).slice(0, paragraphsOf(grown.content).indexOf("-ii-")).join("\n\n");
    const atEnd = remapReadingPosition(grownOld, grown.content, {
      paragraphIndex: storedParagraphs[largest.chapter - 1] - 1,
      percentage: 100,
    });
    assert.ok(largest.factor > 10, `largest expansion is ${largest.factor.toFixed(1)}x (chapter ${largest.chapter})`);
    assert.ok(atEnd.percentage <= 10, `chapter ${largest.chapter}: ${atEnd.percentage} %`);

    // The production row (chapter 1, last stored paragraph, 100 %) lands in the middle of the longer chapter.
    const one = epub.chapters[0];
    const oneOld = paragraphsOf(one.content).slice(0, 10).join("\n\n");
    const row = remapReadingPosition(oneOld, one.content, { paragraphIndex: 9, percentage: 100 });
    assert.equal(row.paragraphIndex, 9);
    assert.ok(row.percentage > 10 && row.percentage < 90, `${row.percentage} %`);
  },
);

async function minimalEpub(body: string) {
  const zip = new JSZip();
  zip.file("META-INF/container.xml", '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>');
  zip.file(
    "book.opf",
    `<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Short Tale</dc:title><dc:creator>Poe, Edgar Allan</dc:creator><dc:language>en</dc:language></metadata>
     <manifest><item id="text" href="text.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="text"/></spine></package>`,
  );
  zip.file("text.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><body>${body}</body></html>`);

  return zip.generateAsync({ type: "nodebuffer" });
}

test("REVIEW: a legitimately short book imports without warnings, while a truncated spine is a hard failure", async () => {
  const tale = `<h2>The Tell-Tale Heart</h2><p>${"True! nervous, very dreadfully nervous I had been and am; ".repeat(12)}</p>`;
  const epub = await parseEpub(await minimalEpub(tale));

  assert.equal(epub.chapters.length, 1);
  assert.equal(epub.chapters[0].title, "The Tell-Tale Heart");
  assert.deepEqual(epub.extraction.warnings, []);
  assert.ok(epub.chapters[0].wordCount > 100 && epub.chapters[0].wordCount < 1000);

  // The same file with a declared spine document missing from the archive is incomplete, not "short".
  const zip = await JSZip.loadAsync(await minimalEpub(tale));
  zip.remove("text.xhtml");
  await assert.rejects(parseEpub(await zip.generateAsync({ type: "nodebuffer" })), /spine document not found/);
});
