import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChapterBlocks } from "../../src/lib/chapter-blocks";
import {
  buildImportDiff,
  canonicalJson,
  computePlanDigest,
  defaultImportFlags,
  evaluateImportPolicy,
  formatImportDiff,
  type PlanInput,
  type PlannedImage,
} from "./import-plan";
import type { EditionAssetRecord, EditionState } from "./import-state";

// The plan with blocks and images: a change in blocks alone is a change, images are planned per source path against
// the edition's associations, and the v3 digest covers both, the warnings and their acceptance, independently of the
// order of equivalent data. Pure functions only.

const paragraphs = (content: string): ChapterBlocks => ({
  version: 1,
  blocks: content.split("\n\n").map((text) => ({ type: "paragraph", content: [{ text }] })),
});

const content = "First paragraph.\n\nSecond paragraph.";
const emphasized: ChapterBlocks = {
  version: 1,
  blocks: [
    { type: "paragraph", content: [{ text: "First " }, { text: "paragraph", marks: ["em"] }, { text: "." }] },
    { type: "paragraph", content: [{ text: "Second paragraph." }] },
  ],
};
const withFigure: ChapterBlocks = {
  version: 1,
  blocks: [
    ...paragraphs(content).blocks,
    { type: "figure", image: { path: "OEBPS/images/a.png", mediaType: "image/png" }, alt: "A", caption: [] },
  ],
};

const image = (sourcePath: string, overrides: Partial<PlannedImage> = {}): PlannedImage => ({
  sourcePath,
  sourceSha256: "1".repeat(64),
  codecId: "sharp@0.35.5/test",
  maxWidth: 1600,
  sha256: "2".repeat(64),
  key: `illustrations/${"2".repeat(64)}.png`,
  mediaType: "image/png",
  width: 10,
  height: 5,
  bytes: 100,
  ...overrides,
});

const asset = (planned: PlannedImage, assetId = "asset-1"): EditionAssetRecord => ({
  sourcePath: planned.sourcePath,
  assetId,
  sourceSha256: planned.sourceSha256,
  codecId: planned.codecId,
  maxWidth: planned.maxWidth,
  sha256: planned.sha256,
  objectKey: planned.key,
  mediaType: planned.mediaType,
  width: planned.width,
  height: planned.height,
  byteSize: planned.bytes,
});

function state(blocks: unknown, overrides: Partial<EditionState> = {}): EditionState {
  return {
    book: { id: "book-1", slug: "test-book" },
    bookAuthors: [{ id: "a1", slug: "jane-austen", name: "Jane Austen" }],
    creatorAuthors: [],
    edition: {
      id: "edition-1",
      bookId: "book-1",
      slug: "en-gutenberg-7",
      language: "en",
      title: "Test Book",
      translator: null,
      publicationYear: null,
      coverUrl: null,
      sourceUrl: "https://www.gutenberg.org/ebooks/7",
      copyrightStatus: "PUBLIC_DOMAIN_VERIFIED",
      publicationStatus: "PUBLISHED",
    },
    chapters: [{ id: "c1", number: 1, slug: "one", title: "One", content, wordCount: 4, blocks }],
    assets: [],
    progressChapterIds: [],
    progressRows: [],
    ...overrides,
  };
}

function input(blocks: ChapterBlocks, extra: Partial<PlanInput> = {}, images: PlannedImage[] = []): PlanInput {
  return {
    bookSlug: "test-book",
    slugWasExplicit: true,
    gutenbergId: "7",
    epubSha256: "a".repeat(64),
    incoming: {
      title: "Test Book",
      language: "en",
      translator: null,
      creators: ["Austen, Jane"],
      coverKey: null,
      chapters: [{ number: 1, slug: "one", title: "One", content, wordCount: 4, blocks }],
      images,
    },
    warnings: [],
    ...extra,
  };
}

const digest = (current: EditionState, plan: PlanInput, acceptWarnings = false) =>
  computePlanDigest(current, plan, buildImportDiff(current, plan), { acceptWarnings });

test("a chapter whose text is the same but whose blocks differ, are missing or are invalid is modified", () => {
  const unchanged = buildImportDiff(state(paragraphs(content)), input(paragraphs(content)));
  assert.equal(unchanged.chapters[0].kind, "unchanged");
  assert.equal(unchanged.hasChanges, false);

  for (const [stored, label] of [
    [emphasized, "other formatting"],
    [null, "imported before blocks"],
    [{ version: 1, blocks: [{ type: "html", html: "<b>x</b>" }] }, "outside the schema"],
    [paragraphs("Some older text."), "derived from another text"],
  ] as const) {
    const diff = buildImportDiff(state(stored), input(paragraphs(content)));
    assert.equal(diff.chapters[0].kind, "modified", label);
    assert.deepEqual(diff.chapters[0].changes, ["blocks"], label);
    assert.equal(diff.totals.blocksChanges, 1, label);
    assert.equal(diff.hasChanges, true, label);
  }
  // Stored blocks are compared by value, not by the key order jsonb returns them in.
  const reordered = JSON.parse(JSON.stringify(emphasized), (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).reverse())
      : value,
  );
  assert.equal(buildImportDiff(state(reordered), input(emphasized)).chapters[0].kind, "unchanged");

  const text = formatImportDiff(buildImportDiff(state(null), input(paragraphs(content)))).join("\n");
  assert.match(text, /0 content, 1 blocks/);
  assert.match(text, /~ one: blocks added/);
});

test("a blocks-only change to a PUBLISHED edition needs --revise-published and the current plan hash", () => {
  const current = state(null);
  const plan = input(paragraphs(content));
  const diff = buildImportDiff(current, plan);
  const reviewed = digest(current, plan);
  const policy = (flags = defaultImportFlags) =>
    evaluateImportPolicy({ diff, digest: reviewed, extractionWarnings: [], slugWasExplicit: true, flags });

  assert.match(policy().join(), /PUBLISHED and the plan changes it/);
  assert.match(policy({ ...defaultImportFlags, revisePublished: true }).join(), /requires --plan-hash/);
  assert.match(
    policy({ ...defaultImportFlags, revisePublished: true, planHash: "0".repeat(20) }).join(),
    /does not match the current plan/,
  );
  assert.deepEqual(policy({ ...defaultImportFlags, revisePublished: true, planHash: reviewed }), []);
});

test("images are planned per source path: new, changed, unchanged and removed, and only this edition's", () => {
  const a = image("OEBPS/images/a.png");
  const b = image("OEBPS/images/b.png", { sourceSha256: "3".repeat(64) });
  const c = image("OEBPS/images/c.png");
  const current = state(withFigure, {
    assets: [asset(a), asset({ ...b, sha256: "9".repeat(64), key: `illustrations/${"9".repeat(64)}.png` }), asset(c)],
  });
  const d = image("OEBPS/images/d.png");
  const diff = buildImportDiff(current, input(withFigure, {}, [d, b, a]));

  assert.deepEqual(
    diff.images.map((change) => [change.sourcePath, change.kind]),
    [
      ["OEBPS/images/a.png", "unchanged"],
      ["OEBPS/images/b.png", "changed"],
      ["OEBPS/images/c.png", "removed"],
      ["OEBPS/images/d.png", "new"],
    ],
  );
  assert.deepEqual(
    [diff.totals.imagesNew, diff.totals.imagesChanged, diff.totals.imagesUnchanged, diff.totals.imagesRemoved],
    [1, 1, 1, 1],
  );
  assert.equal(diff.hasChanges, true, "images alone are a change");

  // Another codec for the same source makes the association change: the published edition's images are protected.
  const recoded = buildImportDiff(
    state(withFigure, { assets: [asset(a)] }),
    input(withFigure, {}, [image(a.sourcePath, { codecId: "sharp@0.36.0/test" })]),
  );
  assert.equal(recoded.images[0].kind, "changed");
  assert.equal(recoded.hasChanges, true);

  const text = formatImportDiff(diff).join("\n");
  assert.match(text, /Images: 1 new, 1 changed, 1 unchanged, 1 to dissociate/);
  assert.match(text, /- OEBPS\/images\/c\.png/);
});

test("the v3 digest covers blocks, images, the codec, stored associations, warnings and their acceptance", () => {
  const a = image("OEBPS/images/a.png");
  const current = state(withFigure, { assets: [asset(a)] });
  const plan = input(withFigure, {}, [a]);
  const base = digest(current, plan);
  assert.equal(digest(current, plan), base, "deterministic");

  const variants = [
    digest(current, input(emphasized, {}, [a])),
    digest(current, input(withFigure, {}, [image(a.sourcePath, { sha256: "4".repeat(64) })])),
    digest(current, input(withFigure, {}, [image(a.sourcePath, { codecId: "sharp@0.36.0/test" })])),
    digest(current, input(withFigure, {}, [image(a.sourcePath, { maxWidth: 1200 })])),
    digest(state(withFigure, { assets: [asset(a, "asset-2")] }), plan),
    digest(state(withFigure), plan),
    digest(state(emphasized, { assets: [asset(a)] }), plan),
    digest(current, input(withFigure, { warnings: ["Image unavailable: x"] }, [a])),
    digest(current, plan, true),
  ];
  assert.equal(new Set([base, ...variants]).size, variants.length + 1);
});

test("equivalent data in another order gives the same digest", () => {
  const a = image("OEBPS/images/a.png");
  const b = image("OEBPS/images/b.png", { sourceSha256: "3".repeat(64) });
  const warnings = ["first warning", "second warning"];
  const one = digest(
    state(withFigure, { assets: [asset(a), asset(b, "asset-2")] }),
    input(withFigure, { warnings }, [a, b]),
  );
  const other = digest(
    state(JSON.parse(canonicalJson(withFigure)), { assets: [asset(b, "asset-2"), asset(a)] }),
    input(withFigure, { warnings: [...warnings].reverse() }, [b, a]),
  );
  assert.equal(one, other);
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
});

test("warnings block the write until accepted, and the accepted plan has its own digest", () => {
  const current = state(paragraphs(content), { edition: { ...state(null).edition!, publicationStatus: "DRAFT" } });
  const plan = input(emphasized, { warnings: ["Image unavailable in Gutenberg 7, chapter 1: bad.png"] });
  const diff = buildImportDiff(current, plan);
  const policy = (acceptWarnings: boolean) =>
    evaluateImportPolicy({
      diff,
      digest: digest(current, plan, acceptWarnings),
      extractionWarnings: plan.warnings,
      slugWasExplicit: true,
      flags: { ...defaultImportFlags, acceptWarnings },
    });
  assert.match(policy(false).join(), /1 warning\(s\).*--accept-warnings \(to the dry run too/);
  assert.deepEqual(policy(true), []);
  assert.notEqual(digest(current, plan, false), digest(current, plan, true));
});
