import assert from "node:assert/strict";
import { test } from "node:test";

import {
  blockPlainText,
  deriveChapterContent,
  normalizeInline,
  parseChapterBlocks,
  type ChapterBlock,
} from "../../src/lib/chapter-blocks";
import { buildEpub3, epubFixtures, pngPixel, type EpubFixtureName, type FixtureResource } from "./epub-fixtures";
import { defaultEpubLimits, parseEpub } from "./parse-epub";

// Typed blocks extracted from the fixture EPUBs: order, formatting, lists, verse, figures and captions, drop capitals,
// unusable images and the plain text derived from the blocks. In memory only: no importer, PostgreSQL or R2.

const s = (label: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${label} sentence ${index + 1} keeps the reader company.`).join(" ");
const p = (text: string): ChapterBlock => ({ type: "paragraph", content: [{ text }] });

async function chapterBlocks(epub: Buffer | Promise<Buffer>, chapter = 0) {
  const parsed = await parseEpub(await epub);
  return { parsed, blocks: parsed.chapters[chapter].blocks.blocks };
}

const single = (body: string, resources: FixtureResource[] = []) =>
  buildEpub3({
    title: "Single Fixture",
    documents: [{ href: "chapter.xhtml", body: `<h2>Chapter I</h2>${body}` }],
    resources,
  });

test("the content of every fixture is exactly the plain text of its blocks, one paragraph per text block", async () => {
  for (const name of Object.keys(epubFixtures) as EpubFixtureName[]) {
    const epub = await parseEpub(await epubFixtures[name]());
    for (const chapter of epub.chapters) {
      const { blocks } = chapter.blocks;
      assert.equal(chapter.content, deriveChapterContent(blocks), `${name} ${chapter.slug}`);
      const textBlocks = blocks.filter((block) => blockPlainText(block) !== null);
      assert.equal(chapter.content.split("\n\n").length, textBlocks.length, `${name} ${chapter.slug}: paragraphs`);
      // Figures and separators never add a paragraph; their captions and alts never reach the text.
      for (const block of blocks.filter((block) => block.type === "figure")) {
        for (const text of [block.alt, block.caption.map((run) => run.text).join("")].filter(Boolean)) {
          assert.ok(!chapter.content.split("\n\n").includes(text), `${name}: "${text}" duplicated as a paragraph`);
        }
      }
      // Stored blocks will be validated with the same parser.
      assert.deepEqual(parseChapterBlocks(chapter.blocks), chapter.blocks);
    }
  }
});

test("structure: headings, emphasis, lists, quotations and verse become typed blocks in reading order", async () => {
  const { blocks } = await chapterBlocks(epubFixtures.structure());

  assert.deepEqual(blocks, [
    {
      type: "paragraph",
      content: [
        { text: "The opening paragraph has " },
        { text: "emphasis", marks: ["em"] },
        { text: ", " },
        { text: "italics", marks: ["em"] },
        { text: " and " },
        { text: "strong", marks: ["strong"] },
        { text: " words in it." },
      ],
    },
    { type: "heading", level: 3, content: [{ text: "A Subheading" }] },
    p(s("Middle", 2)),
    { type: "listItem", ordered: false, content: [{ text: "First item of the list." }] },
    { type: "listItem", ordered: false, content: [{ text: "Second item of the list." }] },
    { type: "listItem", ordered: true, content: [{ text: "One ordered step." }] },
    { type: "listItem", ordered: true, content: [{ text: "Two ordered steps." }] },
    { type: "quote", content: [{ text: "A quoted passage stands apart." }] },
    {
      type: "verse",
      lines: [
        [{ text: "The first line of verse," }],
        [{ text: "the second line of verse," }],
        [{ text: "the third line of verse." }],
      ],
    },
    p(s("Closing", 2)),
  ]);
});

test("a figure keeps its archive path, alt and caption, between the paragraphs it stands between", async () => {
  const { parsed, blocks } = await chapterBlocks(epubFixtures.figureWithCaption());

  assert.deepEqual(blocks, [
    p(s("Before", 2)),
    {
      type: "figure",
      image: { path: "OEBPS/images/plate-1.png", mediaType: "image/png" },
      alt: "A ship at anchor",
      caption: [{ text: "“The ship lay at anchor.”" }],
    },
    p(s("Between", 2)),
    {
      type: "figure",
      image: { path: "OEBPS/images/plate-2.png", mediaType: "image/png" },
      alt: "",
      caption: [{ text: "“they entered the breakfast room”" }],
    },
    p(s("After", 2)),
  ]);
  assert.deepEqual(parsed.extraction.images, {
    figures: 2,
    inSections: 2,
    resolved: 2,
    unavailable: [],
    dropCaps: 0,
    decorative: 0,
    ornaments: 0,
    wrapperImages: 0,
  });
});

test("a decorative image in a heading leaves the heading text as the title and adds no figure", async () => {
  const { parsed, blocks } = await chapterBlocks(epubFixtures.decorativeHeadingImage());

  assert.equal(parsed.chapters[0].title, "CHAPTER XXI.");
  assert.deepEqual(blocks, [p(s("Heading", 3))]);
  assert.equal(parsed.extraction.images.decorative, 1);
  assert.equal(parsed.extraction.images.figures, 0);
});

test("a drop capital drawn as an image gives its letter back to the word, once", async () => {
  const { parsed, blocks } = await chapterBlocks(epubFixtures.dropCap());
  assert.deepEqual(blocks, [
    p(`THE discussion of the offer was now nearly at an end. ${s("Drop", 2)}`),
    p(s("Next", 2)),
  ]);
  assert.equal(parsed.extraction.images.dropCaps, 1);

  const letter = { href: "a.png", mediaType: "image/png", data: pngPixel };
  for (const [markup, expected] of [
    // The text already has the letter: the image is ornament only.
    [`<p><img src="a.png" alt="T"/>THE text goes on.</p>`, "THE text goes on."],
    // A one-letter word: the space after the image stays.
    [`<p><span class="letra"><img src="a.png" alt="A"/></span> FEW days after.</p>`, "A FEW days after."],
    // After an opening quotation mark, inside formatting.
    [`<p>“<em><img src="a.png" alt="I"/> HAVE been</em> told.”</p>`, "“I HAVE been told.”"],
    // Two letters (a ligature or digraph capital).
    [`<p><img src="a.png" alt="Th"/>e end.</p>`, "The end."],
  ] as const) {
    const result = await chapterBlocks(single(markup, [letter]));
    assert.equal(result.parsed.chapters[0].content, expected, markup);
    assert.ok(!result.blocks.some((block) => block.type === "figure"), markup);
  }
});

test("an image whose alt is a letter but stands apart from any word is an illustration, not a drop capital", async () => {
  const { blocks } = await chapterBlocks(
    single(`<p>${s("Text", 1)}</p><p><img src="plate-x.png" alt="X"/></p>`, [
      { href: "plate-x.png", mediaType: "image/png", data: pngPixel },
    ]),
  );
  assert.deepEqual(blocks, [
    p(s("Text", 1)),
    { type: "figure", image: { path: "OEBPS/plate-x.png", mediaType: "image/png" }, alt: "X", caption: [] },
  ]);
});

test("mixed chapters: a chapter without images, one with a captioned figure, one with unusable images", async () => {
  const parsed = await parseEpub(await epubFixtures.mixedChapters());
  const [first, second, third] = parsed.chapters.map((chapter) => chapter.blocks.blocks);

  assert.deepEqual(first, [p(s("Plain", 3))]);
  assert.deepEqual(second, [
    p(s("Illustrated", 2)),
    {
      type: "figure",
      image: { path: "OEBPS/images/toto.png", mediaType: "image/png" },
      alt: "She caught Toto by the ear.",
      caption: [{ text: '"' }, { text: "She caught Toto by the ear.", marks: ["em"] }, { text: '"' }],
    },
    p(s("Later", 2)),
  ]);
  // The missing image and the damaged one (a PNG signature with nothing after it) keep their alt with no resource.
  // Until image inspection, the damaged one was accepted from its signature alone.
  assert.deepEqual(third, [
    p(s("Damaged", 2)),
    { type: "figure", image: null, alt: "A missing plate", caption: [] },
    { type: "figure", image: null, alt: "A damaged plate", caption: [] },
    p(s("End", 2)),
  ]);
  assert.deepEqual(parsed.extraction.images.unavailable, [
    {
      reference: "images/missing.png",
      path: "OEBPS/images/missing.png",
      section: 2,
      code: "missing",
      reason: "missing from the archive",
    },
    {
      reference: "images/broken.png",
      path: "OEBPS/images/broken.png",
      section: 2,
      code: "truncated",
      reason: "PNG ends inside a chunk header",
    },
  ]);
  // The extractor's own warnings stay text-only; unusable images become structured image warnings, which the
  // importer treats as warnings that block a write until accepted.
  assert.deepEqual(parsed.extraction.warnings, []);
  assert.deepEqual(parsed.imageWarnings, [
    {
      chapter: 3,
      chapterTitle: parsed.chapters[2].title,
      reference: "images/missing.png",
      sourcePath: "OEBPS/images/missing.png",
      code: "missing",
      reason: "missing from the archive",
    },
    {
      chapter: 3,
      chapterTitle: parsed.chapters[2].title,
      reference: "images/broken.png",
      sourcePath: "OEBPS/images/broken.png",
      code: "truncated",
      reason: "PNG ends inside a chunk header",
    },
  ]);
  // Parsed without a codec: inspected, not normalized.
  assert.equal(parsed.images, null);
});

test("superscript, subscript, small capitals and nested formatting are typed marks in canonical order", async () => {
  const { blocks } = await chapterBlocks(
    single(
      `<p>H<sub>2</sub>O and E = mc<sup>2</sup>, <span class="smcap">Anno Domini</span>, <strong><em>both</em></strong>.</p>`,
    ),
  );
  assert.deepEqual(blocks, [
    {
      type: "paragraph",
      content: [
        { text: "H" },
        { text: "2", marks: ["sub"] },
        { text: "O and E = mc" },
        { text: "2", marks: ["sup"] },
        { text: ", " },
        { text: "Anno Domini", marks: ["smallCaps"] },
        { text: ", " },
        { text: "both", marks: ["em", "strong"] },
        { text: "." },
      ],
    },
  ]);
});

test("a thematic break separates paragraphs, but never opens or closes a chapter or repeats", async () => {
  const { parsed, blocks } = await chapterBlocks(
    single(`<hr/><p>${s("One", 1)}</p><hr class="tb"/><hr/><p>${s("Two", 1)}</p><hr class="chap"/>`),
  );
  assert.deepEqual(blocks, [p(s("One", 1)), { type: "separator" }, p(s("Two", 1))]);
  assert.equal(parsed.chapters[0].content, `${s("One", 1)}\n\n${s("Two", 1)}`);
});

test("external, data:, script and escaping image references never become a resource", async () => {
  const { parsed, blocks } = await chapterBlocks(
    single(
      `<p onclick="alert(1)">${s("Safe", 1)}<script>alert(2)</script> <a href="javascript:alert(3)">link</a></p>
<div class="figcenter"><img src="https://example.com/x.png" alt="remote"/></div>
<div class="figcenter"><img src="//example.com/y.png" alt="protocol relative"/></div>
<div class="figcenter"><img src="data:image/png;base64,${pngPixel.toString("base64")}" alt="inline data"/></div>
<div class="figcenter"><img src="../../../outside.png" alt="escaping"/></div>
<div class="figcenter"><img src="undeclared.png" alt="undeclared"/></div>
<div class="figcenter"><img src="drawing.svg" alt="vector"/></div>`,
      [
        {
          href: "drawing.svg",
          mediaType: "image/svg+xml",
          data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        },
      ],
    ),
  );
  // undeclared.png is in neither the manifest nor the archive; an archived but undeclared file is tested below.
  const figures = blocks.filter((block) => block.type === "figure");
  assert.equal(figures.length, 6);
  assert.ok(figures.every((figure) => figure.image === null));
  assert.deepEqual(
    parsed.extraction.images.unavailable.map((item) => `${item.code}: ${item.reason}`),
    [
      "outside-epub: not a path inside the EPUB",
      "outside-epub: not a path inside the EPUB",
      "outside-epub: not a path inside the EPUB",
      "outside-epub: not a path inside the EPUB",
      "missing: missing from the archive",
      // Refused by its bytes, never handed to a decoder (sharp would rasterize SVG).
      "unsupported-format: SVG or XML; only JPEG, PNG and WebP are accepted",
    ],
  );
  // Only text and typed fields: no markup, handler, script or URL reaches the blocks.
  const serialized = JSON.stringify(blocks);
  for (const forbidden of ["alert(", "javascript:", "onclick", "<script", "https://", "data:", "outside.png"]) {
    assert.ok(!serialized.includes(forbidden), forbidden);
  }
  assert.equal(parsed.chapters[0].content, `${s("Safe", 1)} link`);
});

test("an image present in the archive but not declared in the manifest is not used", async () => {
  const zipEpub = await buildEpub3({
    title: "Undeclared Fixture",
    documents: [
      {
        href: "chapter.xhtml",
        body: `<h2>Chapter I</h2><p>${s("Text", 1)}</p><div class="fig"><img src="undeclared-plate.png" alt="hidden"/></div>`,
      },
    ],
  });
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(zipEpub);
  zip.file("OEBPS/undeclared-plate.png", pngPixel);
  const { parsed, blocks } = await chapterBlocks(zip.generateAsync({ type: "nodebuffer" }));

  assert.deepEqual(blocks.at(-1), { type: "figure", image: null, alt: "hidden", caption: [] });
  assert.equal(parsed.extraction.images.unavailable[0].code, "undeclared");
  assert.equal(parsed.extraction.images.unavailable[0].reason, "not declared as an image in the manifest");
});

test("images that fail inspection or exceed the edition's limits keep their alt and caption but no image", async () => {
  const resources = [
    { href: "fine.png", mediaType: "image/png", data: pngPixel },
    { href: "renamed.png", mediaType: "image/png", data: Buffer.from("GIF89a, renamed to .png") },
    { href: "also-fine.png", mediaType: "image/png", data: pngPixel },
    { href: "third.png", mediaType: "image/png", data: pngPixel },
  ];
  const figures = resources.map(({ href }) => `<div class="figcenter"><img src="${href}" alt="${href} plate"/></div>`);
  const epub = await single(`<p>${s("Text", 1)}</p>${figures.join("")}${figures[0]}`, resources);
  // Two distinct images at most: the first two usable ones in reading order are kept; fine.png again costs nothing.
  const parsed = await parseEpub(epub, {
    images: { ...defaultEpubLimits.images, maxImagesPerEdition: 2 },
  });
  const images = parsed.chapters[0].blocks.blocks.flatMap((block) => (block.type === "figure" ? [block] : []));

  assert.deepEqual(
    images.map((figure) => [figure.alt, figure.image?.path ?? null]),
    [
      ["fine.png plate", "OEBPS/fine.png"],
      ["renamed.png plate", null],
      ["also-fine.png plate", "OEBPS/also-fine.png"],
      ["third.png plate", null],
      ["fine.png plate", "OEBPS/fine.png"],
    ],
  );
  assert.deepEqual(
    parsed.extraction.images.unavailable.map((item) => [item.reference, item.code]),
    [
      ["renamed.png", "unsupported-format"],
      ["third.png", "edition-count-exceeded"],
    ],
  );
});

test("whitespace normalization keeps formatting and matches the plain-text rule exactly", () => {
  const plainRule = (value: string) =>
    value
      .replace(/&nbsp;| /g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const samples: [string, ("em" | "strong")[]][][] = [
    [
      ["  Leading", []],
      ["\n\nand ", ["em"]],
      [" trailing\t ", []],
    ],
    [
      ["word", ["em"]],
      [" next", []],
    ],
    [
      ["a", []],
      [" ", ["em"]],
      [" b", []],
    ],
    [
      ["   ", ["strong"]],
      ["only", []],
      ["   ", []],
    ],
  ];
  for (const sample of samples) {
    const runs = sample.map(([text, marks]) => (marks.length ? { text, marks } : { text }));
    const normalized = normalizeInline(runs);
    assert.equal(normalized.map((run) => run.text).join(""), plainRule(runs.map((run) => run.text).join("")));
    assert.ok(normalized.every((run) => run.text.length > 0));
  }
  // The collapsed space keeps the formatting of the whitespace it replaces.
  assert.deepEqual(normalizeInline([{ text: "word", marks: ["em"] }, { text: " next" }]), [
    { text: "word", marks: ["em"] },
    { text: " next" },
  ]);
});

test("the block validator rejects anything outside the schema", () => {
  const valid = { version: 1, blocks: [{ type: "paragraph", content: [{ text: "Text." }] }] };
  assert.deepEqual(parseChapterBlocks(valid), valid);

  const figure = (image: unknown) => ({ version: 1, blocks: [{ type: "figure", image, alt: "", caption: [] }] });
  for (const [value, error] of [
    [{ version: 2, blocks: [] }, /unsupported version/],
    [{ version: 1, blocks: [{ type: "html", html: "<b>x</b>" }] }, /unknown block type "html"/],
    [{ version: 1, blocks: [{ type: "paragraph", content: [{ text: "x", marks: ["script"] }] }] }, /unknown mark/],
    [{ version: 1, blocks: [{ type: "paragraph", content: [{ text: "x", marks: ["strong", "em"] }] }] }, /canonical/],
    [{ version: 1, blocks: [{ type: "paragraph", content: [{ text: " x  y" }] }] }, /whitespace-normalized/],
    [{ version: 1, blocks: [{ type: "paragraph", content: [] }] }, /text is empty/],
    [{ version: 1, blocks: [{ type: "paragraph", content: [{ text: "x" }], html: "<i>" }] }, /unknown field html/],
    [{ version: 1, blocks: [{ type: "heading", level: 7, content: [{ text: "x" }] }] }, /level/],
    [figure({ path: "../secret.png", mediaType: "image/png" }), /normalized relative path/],
    [figure({ path: "https://example.com/x.png", mediaType: "image/png" }), /normalized relative path/],
    [figure({ path: "/etc/x.png", mediaType: "image/png" }), /normalized relative path/],
    [figure({ path: "OEBPS/x.svg", mediaType: "image/svg+xml" }), /unsupported media type/],
    [figure({ path: "OEBPS/x.png", mediaType: "image/png", url: "https://x" }), /unknown field url/],
  ] as const) {
    assert.throws(() => parseChapterBlocks(value), error, JSON.stringify(value));
  }
});

// Ornaments, file-name alts, punctuated drop capitals and wrapper pages, in the forms found in the catalogue EPUBs.

const image = (href: string): FixtureResource => ({ href, mediaType: "image/png", data: pngPixel });

/** Figure image paths of every chapter, and no chapter may repeat one. */
function figurePaths(parsed: Awaited<ReturnType<typeof parseEpub>>) {
  return parsed.chapters.map((chapter) => {
    const paths = chapter.blocks.blocks.flatMap((block) =>
      block.type === "figure" && block.image ? [block.image.path] : [],
    );
    assert.equal(new Set(paths).size, paths.length, `${chapter.slug}: a figure repeats`);
    return paths;
  });
}

test("ornaments are left out without losing a letter of the text", async () => {
  const { parsed, blocks } = await chapterBlocks(
    single(
      // The Adventures of Sherlock Holmes: a drop-cap image in its own block, the text keeps its letters.
      `<div class="fig100"><img alt="" class="drop-cap" src="drop_t.jpg"/></div>
<p class="first-para drop-cap">TO Sherlock Holmes she is always <em>the</em> woman.</p>
<div class="fig100"><img alt="" class="drop-cap2" src="drop_m.jpg"/></div>
<p class="first-para drop-cap2">MY friend.</p>
<p class="drop-img"><span class="drop-img"><img alt="" src="9029m.jpg" role="presentation"/></span> Squire Trelawney asked me to write.</p>
<p class="nind"><span class="letra"><img alt="" src="i_282_b.png"/></span>ELIZABETH did not expect it.</p>
<p class="figcenter" role="figure" aria-labelledby="map-caption"><a href="map-large.xhtml"><img alt="" class="enlargeimage" src="enlarge-image.jpg"/></a>
<img alt="MAPA DE LA ISLA" src="illus-003_sml.jpg"/><span class="caption" id="map-caption">Mapa trazado por el capitán Flint.</span></p>
<p class="figcenter"><a href="deco.xhtml"><img alt="[imagen decorativa no disponible]" src="5027814354573229812_deco-018_sml.png"/></a></p>
<p>${s("After", 1)}</p>`,
      [
        "drop_t.jpg",
        "drop_m.jpg",
        "9029m.jpg",
        "i_282_b.png",
        "enlarge-image.jpg",
        "illus-003_sml.jpg",
        "5027814354573229812_deco-018_sml.png",
      ].map(image),
    ),
  );

  assert.deepEqual(blocks, [
    {
      type: "paragraph",
      content: [{ text: "TO Sherlock Holmes she is always " }, { text: "the", marks: ["em"] }, { text: " woman." }],
    },
    p("MY friend."),
    p("Squire Trelawney asked me to write."),
    p("ELIZABETH did not expect it."),
    // The enlarge icon shares the map's figure container: only the map remains, and it keeps the caption.
    {
      type: "figure",
      image: { path: "OEBPS/illus-003_sml.jpg", mediaType: "image/png" },
      alt: "MAPA DE LA ISLA",
      caption: [{ text: "Mapa trazado por el capitán Flint." }],
    },
    p(s("After", 1)),
  ]);
  assert.equal(parsed.extraction.images.ornaments, 6);
  assert.equal(parsed.extraction.images.figures, 1);
});

test("an image without alt is an ornament only at the start of a paragraph that already has its letter", async () => {
  const { blocks } = await chapterBlocks(
    single(`<p>${s("Text", 1)} <img alt="" src="inline-plate.png"/> ${s("More", 1)}</p>`, [image("inline-plate.png")]),
  );
  // Inside a paragraph, after its first words: an illustration, placed after the paragraph it interrupts.
  assert.deepEqual(blocks, [
    p(`${s("Text", 1)} ${s("More", 1)}`),
    { type: "figure", image: { path: "OEBPS/inline-plate.png", mediaType: "image/png" }, alt: "", caption: [] },
  ]);
});

test("an alt that only repeats the file name describes nothing", async () => {
  const cases: [src: string, alt: string, expected: string][] = [
    // Treasure Island: ebookmaker prefixes "<digits>_" to the original file name the alt repeats.
    ["6484518377310807417_0033m.jpg", "0033m", ""],
    ["6484518377310807417_0033m.jpg", "0033m.jpg", ""],
    ["3410273881376585714_colophon.png", "Colophon", ""],
    // A real description stays, even when it shares words with the file name.
    ["5002275010448205890_i009_edit.jpg", "Dorothy and Toto", "Dorothy and Toto"],
    ["toto.png", "Toto running", "Toto running"],
  ];
  for (const [src, alt, expected] of cases) {
    const { blocks } = await chapterBlocks(
      single(`<p>${s("Text", 1)}</p><div class="figcenter"><img alt="${alt}" src="${src}"/></div>`, [image(src)]),
    );
    const figure = blocks.find((block) => block.type === "figure");
    assert.ok(figure && figure.type === "figure", src);
    assert.equal(figure.alt, expected, `${src} alt=${alt}`);
  }
});

test("a drop capital drawn with its opening quotation mark gives back both, once", async () => {
  for (const [markup, expected] of [
    // Pride and Prejudice, chapter XIII.
    [
      `<p class="nind"><span class="letra"><img alt="“I" src="i_107_b.png"/></span> hope, my dear,” said Mr. Bennet.</p>`,
      "“I hope, my dear,” said Mr. Bennet.",
    ],
    // The quotation mark already in the text is not repeated.
    [`<p>“<img alt="“I" src="i_107_b.png"/> hope, my dear.”</p>`, "“I hope, my dear.”"],
    // A drawn letter after punctuation the text does not have.
    [`<p><img alt="¡A" src="i_107_b.png"/>LTO ahí!</p>`, "¡ALTO ahí!"],
  ] as const) {
    const { parsed, blocks } = await chapterBlocks(single(markup, [image("i_107_b.png")]));
    assert.equal(parsed.chapters[0].content, expected, markup);
    assert.ok(!blocks.some((block) => block.type === "figure"), markup);
    assert.equal(parsed.extraction.images.dropCaps, 1, markup);
  }
});

test("a wrapper page holding the enlarged copy of a linked image is never a figure of its own", async () => {
  const parsed = await parseEpub(
    await buildEpub3({
      title: "Wrapper Fixture",
      documents: [
        {
          href: "chapter.xhtml",
          body: `<h2>Chapter I</h2><p>${s("Before", 1)}</p>
<div class="fig" role="figure" aria-labelledby="c1"><a href="plate-1-large.xhtml"><img alt="The plate" src="plate-1m.png"/></a><p class="caption" id="c1">The caption.</p></div>
<p>${s("After", 1)}</p>`,
        },
        // In the spine, inside the chapter's range: only an image and its "back" link (ebookmaker's form), linked
        // from the chapter's illustration.
        {
          href: "plate-1-large.xhtml",
          body: `<div style="text-align: center"><img alt="" class="x-ebookmaker-wrapper" src="plate-1.png"/><br/><a href="chapter.xhtml#c1" title="back">back</a></div>`,
        },
      ],
      resources: [image("plate-1m.png"), image("plate-1.png")],
    }),
  );

  assert.deepEqual(figurePaths(parsed), [["OEBPS/plate-1m.png"]]);
  assert.equal(parsed.extraction.images.wrapperImages, 1);
  // The illustration keeps its own (smaller) file: the enlarged copy is not substituted for it.
  const figure = parsed.chapters[0].blocks.blocks.find((block) => block.type === "figure");
  assert.deepEqual(figure, {
    type: "figure",
    image: { path: "OEBPS/plate-1m.png", mediaType: "image/png" },
    alt: "The plate",
    caption: [{ text: "The caption." }],
  });
  assert.equal(parsed.chapters[0].content, `${s("Before", 1)}\n\n${s("After", 1)}`);
});

test("a page with an image and text, even if linked from an image, is read as content", async () => {
  const parsed = await parseEpub(
    await buildEpub3({
      title: "Linked Page Fixture",
      documents: [
        {
          href: "chapter.xhtml",
          body: `<h2>Chapter I</h2><p>${s("Text", 1)}</p><p><a href="plate.xhtml"><img alt="Plate" src="plate-m.png"/></a></p>`,
        },
        {
          href: "plate.xhtml",
          body: `<p>${s("Plate text", 1)}</p><div class="figcenter"><img alt="Plate" src="plate.png"/></div>`,
        },
      ],
      resources: [image("plate-m.png"), image("plate.png")],
    }),
  );
  assert.deepEqual(figurePaths(parsed), [["OEBPS/plate-m.png", "OEBPS/plate.png"]]);
  assert.equal(parsed.extraction.images.wrapperImages, 0);
});
