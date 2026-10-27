import assert from "node:assert/strict";
import { test } from "node:test";

import { drizzle } from "drizzle-orm/pg-proxy";

import type { ChapterBlocks } from "../../src/lib/chapter-blocks";
import {
  createOperations,
  EditionConsistencyError,
  ImageAssetConflictError,
  type ApplyArgs,
  type Transaction,
} from "./import-database";
import { buildImportDiff, type PlanInput, type PlannedImage } from "./import-plan";
import type { EditionAssetRecord, EditionState } from "./import-state";

// The image writes of an import, on the SQL the real query builders generate (a pg-proxy driver records it and
// answers with fixture rows; no connection is opened): verified images only, assets resolved by their unique
// identity, associations changed for this edition only, and the consistency check before commit.

interface Statement {
  sql: string;
  params: unknown[];
}

const content = "One paragraph.";
const figureBlocks = (paths: string[]): ChapterBlocks => ({
  version: 1,
  blocks: [
    { type: "paragraph", content: [{ text: content }] },
    ...paths.map((path) => ({
      type: "figure" as const,
      image: { path, mediaType: "image/png" as const },
      alt: path,
      caption: [],
    })),
  ],
});

const image = (sourcePath: string, digit = "2"): PlannedImage => ({
  sourcePath,
  sourceSha256: `${digit}${"1".repeat(63)}`,
  codecId: "sharp@0.35.5/test",
  maxWidth: 1600,
  sha256: digit.repeat(64),
  key: `illustrations/${digit.repeat(64)}.png`,
  mediaType: "image/png",
  width: 10,
  height: 5,
  bytes: 100,
});

const record = (planned: PlannedImage, assetId: string): EditionAssetRecord => ({
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

/** image_assets columns, in schema order. */
const assetRow = (id: string, planned: PlannedImage, overrides: Partial<Record<string, unknown>> = {}) => {
  const row = {
    id,
    source_sha256: planned.sourceSha256,
    codec_id: planned.codecId,
    max_width: planned.maxWidth,
    sha256: planned.sha256,
    object_key: planned.key,
    media_type: planned.mediaType,
    width: planned.width,
    height: planned.height,
    byte_size: planned.bytes,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
  return Object.values(row);
};

/**
 * A transaction double that keeps the edition's chapters and associations as the writes leave them, so the check
 * before commit reads what the writes produced.
 */
function fakeTransaction({
  chapters,
  associations,
  existingAsset,
}: {
  chapters: { slug: string; content: string; blocks: unknown }[];
  associations: Map<string, PlannedImage>;
  existingAsset?: unknown[];
}) {
  const statements: Statement[] = [];
  const db = drizzle(async (sql, params) => {
    statements.push({ sql, params });
    if (/^insert into "image_assets"/.test(sql)) return { rows: existingAsset ? [] : [[`asset-${params[0]}`]] };
    if (/^select .* from "image_assets"/.test(sql)) return { rows: existingAsset ? [existingAsset] : [] };
    if (/^delete from "edition_assets"/.test(sql)) {
      for (const path of params.slice(1)) associations.delete(String(path));
      return { rows: [] };
    }
    if (/^insert into "edition_assets"/.test(sql)) {
      const path = String(params[params.length - 1]);
      const planned = [...plannedImages.values()].find((item) => item.sourcePath === path);
      if (planned) associations.set(path, planned);
      return { rows: [] };
    }
    if (/^select "slug", "content", "blocks" from "chapters"/.test(sql)) {
      return { rows: chapters.map((row) => [row.slug, row.content, row.blocks]) };
    }
    if (/^select .* from "edition_assets"/.test(sql)) {
      return {
        rows: [...associations.values()].map((item) => [
          item.sourcePath,
          item.sourceSha256,
          item.sha256,
          item.key,
          item.mediaType,
        ]),
      };
    }
    return { rows: [] };
  });
  return { tx: db as unknown as Transaction, statements };
}
const plannedImages = new Map<string, PlannedImage>();

function editionState(assets: EditionAssetRecord[], blocks: unknown): EditionState {
  return {
    book: { id: "book-1", slug: "test-book" },
    bookAuthors: [{ id: "author-1", slug: "jane-austen", name: "Jane Austen" }],
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
      copyrightStatus: "PENDING_REVIEW",
      publicationStatus: "DRAFT",
    },
    chapters: [{ id: "c1", number: 1, slug: "one", title: "One", content, wordCount: 2, blocks }],
    assets,
    progressChapterIds: [],
    progressRows: [],
  };
}

function args(state: EditionState, blocks: ChapterBlocks, images: PlannedImage[], verified = images): ApplyArgs {
  plannedImages.clear();
  for (const item of images) plannedImages.set(item.sourcePath, item);
  const plan: PlanInput = {
    bookSlug: "test-book",
    slugWasExplicit: true,
    gutenbergId: "7",
    epubSha256: "0".repeat(64),
    incoming: {
      title: "Test Book",
      language: "en",
      translator: null,
      creators: ["Austen, Jane"],
      coverKey: null,
      chapters: [{ number: 1, slug: "one", title: "One", content, wordCount: 2, blocks }],
      images,
    },
    warnings: [],
  };
  return {
    state,
    diff: buildImportDiff(state, plan),
    gutenbergId: "7",
    book: { slug: "test-book", originalTitle: "Test Book", originalLanguage: "en", originalPublicationYear: null },
    edition: {
      slug: "en-gutenberg-7",
      language: "en",
      title: "Test Book",
      translator: null,
      publicationYear: null,
      sourceUrl: "https://www.gutenberg.org/ebooks/7",
      coverUrl: null,
    },
    images,
    verifiedKeys: new Set(verified.map((item) => item.key)),
  };
}

test("new images: assets inserted by identity with ON CONFLICT DO NOTHING, associations for this edition", async () => {
  const a = image("OEBPS/images/a.png", "2");
  const b = image("OEBPS/images/b.png", "3");
  const blocks = figureBlocks([a.sourcePath, b.sourcePath]);
  const associations = new Map<string, PlannedImage>();
  const { tx, statements } = fakeTransaction({ chapters: [{ slug: "one", content, blocks }], associations });

  await createOperations(tx).apply(args(editionState([], null), blocks, [a, b]));

  const inserts = statements.filter(({ sql }) => /^insert into "image_assets"/.test(sql));
  assert.equal(inserts.length, 2);
  for (const insert of inserts) {
    assert.match(insert.sql, /on conflict \("source_sha256","codec_id","max_width"\) do nothing/);
  }
  const links = statements.filter(({ sql }) => /^insert into "edition_assets"/.test(sql));
  assert.equal(links.length, 2);
  assert.ok(links.every(({ params }) => params.includes("edition-1")));
  assert.ok(!statements.some(({ sql }) => /^delete from "edition_assets"/.test(sql)), "nothing to dissociate");
  assert.deepEqual([...associations.keys()].sort(), [a.sourcePath, b.sourcePath]);
  // The chapter is written with its blocks and the check before commit reads them back.
  assert.ok(statements.some(({ sql }) => /^update "chapters"/.test(sql)));
  assert.ok(statements.some(({ sql }) => /^select "slug", "content", "blocks" from "chapters"/.test(sql)));
});

test("an asset that already exists (an earlier import or a concurrent winner) is reused when its bytes match", async () => {
  const a = image("OEBPS/images/a.png");
  const blocks = figureBlocks([a.sourcePath]);
  const associations = new Map<string, PlannedImage>();
  const { tx, statements } = fakeTransaction({
    chapters: [{ slug: "one", content, blocks }],
    associations,
    existingAsset: assetRow("asset-existing", a),
  });

  await createOperations(tx).apply(args(editionState([], null), blocks, [a]));

  const link = statements.find(({ sql }) => /^insert into "edition_assets"/.test(sql))!;
  assert.ok(link.params.includes("asset-existing"));
});

test("an existing asset of the same identity with other bytes is a conflict: the write stops", async () => {
  const a = image("OEBPS/images/a.png");
  const blocks = figureBlocks([a.sourcePath]);
  const { tx } = fakeTransaction({
    chapters: [{ slug: "one", content, blocks }],
    associations: new Map(),
    existingAsset: assetRow("asset-existing", a, { sha256: "f".repeat(64), byte_size: 99 }),
  });

  await assert.rejects(createOperations(tx).apply(args(editionState([], null), blocks, [a])), (error: unknown) => {
    assert.ok(error instanceof ImageAssetConflictError);
    assert.match(error.message, /sha256 f{64}, expected 2{64}; byte size 99, expected 100/);
    return true;
  });
});

test("images not verified in the store by this import stop the write before any statement", async () => {
  const a = image("OEBPS/images/a.png");
  const blocks = figureBlocks([a.sourcePath]);
  const { tx, statements } = fakeTransaction({ chapters: [], associations: new Map() });

  await assert.rejects(
    createOperations(tx).apply(args(editionState([], null), blocks, [a], [])),
    /not verified in the object store by this import/,
  );
  assert.deepEqual(statements, []);
});

test("changed and removed associations are deleted for this edition only; unchanged ones are left alone", async () => {
  const kept = image("OEBPS/images/kept.png", "2");
  const changedOld = image("OEBPS/images/changed.png", "3");
  const changedNew = { ...image("OEBPS/images/changed.png", "4") };
  const gone = image("OEBPS/images/gone.png", "5");
  const blocks = figureBlocks([kept.sourcePath, changedNew.sourcePath]);
  const associations = new Map([
    [kept.sourcePath, kept],
    [changedOld.sourcePath, changedOld],
    [gone.sourcePath, gone],
  ]);
  const state = editionState(
    [record(kept, "asset-kept"), record(changedOld, "asset-old"), record(gone, "asset-gone")],
    figureBlocks([kept.sourcePath, changedOld.sourcePath, gone.sourcePath]),
  );
  const { tx, statements } = fakeTransaction({ chapters: [{ slug: "one", content, blocks }], associations });

  await createOperations(tx).apply(args(state, blocks, [kept, changedNew]));

  const deletion = statements.find(({ sql }) => /^delete from "edition_assets"/.test(sql))!;
  assert.match(deletion.sql, /where \("edition_assets"\."edition_id" = \$1 and "edition_assets"\."source_path" in/);
  assert.deepEqual(deletion.params, ["edition-1", changedOld.sourcePath, gone.sourcePath]);
  const links = statements.filter(({ sql }) => /^insert into "edition_assets"/.test(sql));
  assert.equal(links.length, 1, "only the changed path is associated again");
  assert.ok(links[0].params.includes(changedNew.sourcePath));
  // Shared assets are never deleted by an import.
  assert.ok(!statements.some(({ sql }) => /^delete from "image_assets"/.test(sql)));
});

test("the check before commit rolls back a figure without association, or one left unused", async () => {
  const a = image("OEBPS/images/a.png");
  const blocks = figureBlocks([a.sourcePath]);

  // The stored chapter references an image the edition has no association for.
  const orphanFigure = fakeTransaction({
    chapters: [{ slug: "one", content, blocks: figureBlocks(["OEBPS/images/elsewhere.png"]) }],
    associations: new Map(),
  });
  await assert.rejects(createOperations(orphanFigure.tx).apply(args(editionState([], null), blocks, [a])), (error) => {
    assert.ok(error instanceof EditionConsistencyError);
    assert.match(error.message, /figure image OEBPS\/images\/elsewhere\.png has no association/);
    assert.match(error.message, /association OEBPS\/images\/a\.png is used by no figure/);
    return true;
  });

  // Stored blocks that no longer derive their text.
  const stale = fakeTransaction({
    chapters: [{ slug: "one", content: "Another text.", blocks }],
    associations: new Map(),
  });
  await assert.rejects(createOperations(stale.tx).apply(args(editionState([], null), blocks, [a])), /do not derive/);
});
