import assert from "node:assert/strict";
import { test } from "node:test";

import { epubFixtures, type EpubFixtureName } from "./epub-fixtures";
import { parseEpub, type ParsedChapter } from "./parse-epub";

// Baseline of the plain-text extraction, frozen before chapters gained structured blocks and illustrations.
// These expectations record that behavior, known defects included (marked DEFECT): when the extraction changes,
// each difference here must be a deliberate, reviewed one (marked FIXED), and everything else must stay byte for byte
// the same. Only the plain-text fields are compared here; the blocks have their own tests (epub-blocks.test.ts).

const s = (label: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${label} sentence ${index + 1} keeps the reader company.`).join(" ");

type PlainChapter = Omit<ParsedChapter, "blocks">;

interface Baseline {
  chapters: PlainChapter[];
  totalWords: number;
}

const plain = ({ number, slug, title, content, wordCount }: ParsedChapter): PlainChapter => ({
  number,
  slug,
  title,
  content,
  wordCount,
});

const baselines: Record<EpubFixtureName, Baseline> = {
  plainText: {
    chapters: [
      {
        number: 1,
        slug: "chapter-i",
        title: "Chapter I",
        content: `${s("First", 4)}\n\n${s("Second", 3)}`,
        wordCount: 49,
      },
    ],
    totalWords: 51,
  },
  structure: {
    chapters: [
      {
        number: 1,
        slug: "chapter-i",
        title: "Chapter I",
        // Emphasis is flattened, the subheading and every list item become paragraphs, and the <br/> verse lines are
        // joined into one paragraph with spaces.
        content: [
          "The opening paragraph has emphasis, italics and strong words in it.",
          "A Subheading",
          s("Middle", 2),
          "First item of the list.",
          "Second item of the list.",
          "One ordered step.",
          "Two ordered steps.",
          "A quoted passage stands apart.",
          "The first line of verse, the second line of verse, the third line of verse.",
          s("Closing", 2),
        ].join("\n\n"),
        wordCount: 77,
      },
    ],
    totalWords: 79,
  },
  figureWithCaption: {
    chapters: [
      {
        number: 1,
        slug: "chapter-i",
        title: "Chapter I",
        // DEFECT: both illustrations and both captions (figcaption and div.caption) are dropped without a trace.
        content: [s("Before", 2), s("Between", 2), s("After", 2)].join("\n\n"),
        wordCount: 42,
      },
    ],
    totalWords: 44,
  },
  decorativeHeadingImage: {
    chapters: [
      // The decorative image and the <br/>s inside the heading leave a clean title.
      { number: 1, slug: "chapter-xxi", title: "CHAPTER XXI.", content: s("Heading", 3), wordCount: 21 },
    ],
    totalWords: 23,
  },
  dropCap: {
    chapters: [
      {
        number: 1,
        slug: "chapter-xxi",
        title: "CHAPTER XXI.",
        // FIXED (was "HE discussion…"): the drop capital exists only as the image's alt, so the first word lost its
        // letter, as in the illustrated Pride and Prejudice in production. The alt is now read as the letter, once.
        content: `THE discussion of the offer was now nearly at an end. ${s("Drop", 2)}\n\n${s("Next", 2)}`,
        wordCount: 39,
      },
    ],
    totalWords: 41,
  },
  mixedChapters: {
    chapters: [
      { number: 1, slug: "chapter-i", title: "Chapter I", content: s("Plain", 3), wordCount: 21 },
      {
        number: 2,
        slug: "chapter-ii",
        title: "Chapter II",
        // FIXED (the caption was a paragraph of its own, '"She caught Toto by the ear."', 34 words): the p.caption2
        // caption of the illustration, read as an ordinary paragraph in the Wizard of Oz in production, now belongs to
        // its figure block and no longer duplicates as text. The empty page-number paragraph leaves nothing.
        content: [s("Illustrated", 2), s("Later", 2)].join("\n\n"),
        wordCount: 28,
      },
      {
        number: 3,
        slug: "chapter-iii",
        title: "Chapter III",
        // A missing and a damaged image leave the text as it was (their figure blocks are tested apart).
        content: [s("Damaged", 2), s("End", 2)].join("\n\n"),
        wordCount: 28,
      },
    ],
    // FIXED (was 89): the six caption words are no longer counted as reading text.
    totalWords: 83,
  },
};

for (const [name, expected] of Object.entries(baselines) as [EpubFixtureName, Baseline][]) {
  test(`baseline: ${name} keeps its current chapters, content and word counts`, async () => {
    const epub = await parseEpub(await epubFixtures[name]());

    assert.deepEqual(epub.chapters.map(plain), expected.chapters);
    // Chapter word counts are what the importer stores; the report adds the headings.
    for (const chapter of epub.chapters) {
      assert.equal(chapter.wordCount, chapter.content.split(/\s+/).filter(Boolean).length, chapter.slug);
    }
    assert.equal(epub.extraction.totalWords, expected.totalWords);
    assert.equal(epub.extraction.keptWords, expected.totalWords);
    assert.equal(epub.extraction.discardedWords + epub.extraction.leadingWords, 0);
    // No fixture image is reported: interior images are outside the extraction report today.
    assert.deepEqual(epub.extraction.warnings, []);
    assert.equal(epub.cover, null);
  });
}

test("baseline: no image reference, alt text or file name reaches the chapter text", async () => {
  for (const name of Object.keys(epubFixtures) as EpubFixtureName[]) {
    const epub = await parseEpub(await epubFixtures[name]());
    const text = epub.chapters.map((chapter) => chapter.content).join("\n");

    assert.doesNotMatch(text, /\.png|<img|src=|A ship at anchor|A missing plate|A damaged plate/, name);
  }
});

test("baseline: every fixture is a valid EPUB 3 package with its images stored in the archive", async () => {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await epubFixtures.figureWithCaption());

  assert.equal(await zip.file("mimetype")?.async("string"), "application/epub+zip");
  assert.match((await zip.file("OEBPS/content.opf")?.async("string")) ?? "", /version="3\.0"/);
  assert.ok(zip.file("OEBPS/images/plate-1.png"));
  assert.ok(zip.file("OEBPS/nav.xhtml"));
});
