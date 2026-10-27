import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { encodePng } from "./epub-image-fixtures";
import type { ImageCodec } from "./epub-images";
import { buildEpub3 } from "./epub-fixtures";
import type { ApplyArgs, ImportDatabase } from "./import-database";
import { importGutenbergBook, type ImportGutenbergOptions } from "./import-gutenberg";
import { describeDatabaseTarget } from "./import-plan";
import { ImportBlockedError, type EditionState } from "./import-state";
import { R2_SETTINGS, removeRealStorageSettings, testImportDependencies } from "./import-test-guards";
import { MemoryObjectStore } from "./object-store-fixtures";
import { createSharpCodec, SharpEnvironmentError } from "./sharp-codec";

// The importer with illustrations, end to end on doubles: an in-memory database and object store, the real sharp
// codec (unverified, so this runs on any platform). Images are stored and verified outside the write transaction,
// only for a plan the policy accepts, and the write references nothing that was not verified. No PostgreSQL, R2 or
// network.
removeRealStorageSettings();

const sentence = (label: string) => `${label} sentence keeps the reader company. `.repeat(20).trim();
const plate = encodePng({ width: 12, height: 8 });
const broken = encodePng({ width: 9, height: 7 });
const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");

async function illustratedEpub(
  t: TestContext,
  images: { href: string; data: Buffer }[] = [{ href: "images/plate.png", data: plate }],
) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "libra-images-"));
  t.after(async () => {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    await fs.rm(target, { recursive: true, force: true });
  });
  const epub = await buildEpub3({
    title: "Illustrated Book",
    creator: "Austen, Jane",
    documents: [
      {
        href: "chapter1.xhtml",
        body: `<h2>Chapter I</h2><p>${sentence("First")}</p>${images.map(({ href }) => `<div class="figcenter"><img src="${href}" alt="Plate"/></div>`).join("")}`,
      },
      { href: "chapter2.xhtml", body: `<h2>Chapter II</h2><p>${sentence("Second")}</p>` },
    ],
    resources: images.map(({ href, data }) => ({ href, mediaType: "image/png", data })),
  });
  const file = path.join(directory, "book.epub");
  await fs.writeFile(file, epub);
  return file;
}

const emptyState: EditionState = {
  book: null,
  bookAuthors: [],
  creatorAuthors: [],
  edition: null,
  chapters: [],
  assets: [],
  progressChapterIds: [],
  progressRows: [],
};

function fakeDatabase(events: string[], states: EditionState[] = [emptyState]) {
  let reads = 0;
  const committed: ApplyArgs[] = [];
  const database: ImportDatabase = {
    target: describeDatabaseTarget("postgres://libra:not-a-real-password@db.example.invalid:5432/postgres"),
    async readState() {
      events.push("read");
      return states[Math.min(reads++, states.length - 1)];
    },
    async write(_request, run) {
      events.push("transaction");
      const state = states[Math.min(reads++, states.length - 1)];
      const staged: ApplyArgs[] = [];
      const result = await run(state, {
        async apply(args) {
          events.push("apply");
          staged.push(args);
          return { bookId: "book-1", editionId: "edition-new", chapters: args.diff.chapters.length };
        },
      });
      committed.push(...staged);
      events.push("commit");
      return result;
    },
    async close() {},
  };
  return { database, committed };
}

/** A store that records its calls in the shared event log. */
function recordingStore(events: string[]) {
  const store = new MemoryObjectStore();
  for (const operation of ["head", "get", "put"] as const) {
    const original = store[operation].bind(store) as (...args: never[]) => Promise<unknown>;
    Object.assign(store, {
      [operation]: (...args: never[]) => {
        events.push(`store ${operation}`);
        return original(...args);
      },
    });
  }
  return store;
}

function quiet(t: TestContext) {
  const printed: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => printed.push(args.map(String).join(" ")));
  t.mock.method(console, "warn", (...args: unknown[]) => printed.push(args.map(String).join(" ")));
  return printed;
}

const options = (file: string, extra: Partial<ImportGutenbergOptions> = {}): ImportGutenbergOptions => ({
  file,
  gutenbergId: "7",
  slug: "illustrated-book",
  originalTitle: "Illustrated Book",
  originalLanguage: "en",
  ...extra,
});

/** The real codec, optionally rejecting the sources given. */
function codec(reject: Buffer[] = []): () => Promise<ImageCodec> {
  const real = createSharpCodec();
  const refused = new Set(reject.map(sha));
  return async () => ({
    id: real.id,
    normalize: async (data, inspection, target) => {
      if (refused.has(inspection.sourceSha256)) throw new Error("decoder refused the stream");
      return real.normalize(data, inspection, target);
    },
  });
}

function dependencies(database: ImportDatabase, extra: Record<string, unknown> = {}) {
  return testImportDependencies({
    database,
    createCodec: codec(),
    uploadCover: async () => "https://covers.example/covers/uploaded.jpg",
    revalidate: async () => true,
    ...extra,
  });
}

test("an importer test cannot reach the real cover upload by accident", async (t) => {
  quiet(t);
  // The guard refuses dependencies without a test cover upload, or with the real one.
  const { uploadCover } = await import("./r2");
  const { database } = fakeDatabase([]);
  const withoutCover = { database };
  const withRealCover = { database, uploadCover };
  const withoutFunction = { database, uploadCover: "https://covers.example/x.jpg" };
  for (const refused of [withoutCover, withRealCover, withoutFunction]) {
    assert.throws(() => testImportDependencies(refused), /must inject a test uploadCover/);
  }

  // And should the real upload still be reached, it would stop on its first setting: none is in this process. Only
  // presence is checked; no value is read.
  for (const name of R2_SETTINGS) assert.ok(!(name in process.env), `${name} is not in this test process`);
});

test("an unsupported codec environment stops the import before the EPUB is parsed or anything is touched", async (t) => {
  quiet(t);
  const file = await illustratedEpub(t);
  const events: string[] = [];
  const { database } = fakeDatabase(events);
  const store = recordingStore(events);

  await assert.rejects(
    importGutenbergBook(options(file, { apply: true, confirmDatabase: database.target.token }), {
      ...dependencies(database, { objectStore: store }),
      createCodec: async () => {
        throw new SharpEnvironmentError("sharp@0.35.5/.../linux-x64/simd/settings-v2.x", [
          "not an approved environment",
        ]);
      },
    }),
    SharpEnvironmentError,
  );
  assert.deepEqual(events, []);
});

test("a dry run normalizes and plans the images but never touches the object store", async (t) => {
  const printed = quiet(t);
  const file = await illustratedEpub(t);
  const events: string[] = [];
  const { database, committed } = fakeDatabase(events);
  const store = recordingStore(events);

  const outcome = await importGutenbergBook(options(file), dependencies(database, { objectStore: store }));

  assert.equal(outcome.status, "planned");
  assert.ok(outcome.status === "planned" && outcome.diff.totals.imagesNew === 1);
  assert.deepEqual(events, ["read"]);
  assert.deepEqual(committed, []);
  assert.ok(printed.some((line) => /Images: 1 new, 0 changed/.test(line)));
  // No warnings: the flags printed for --apply do not include --accept-warnings.
  const required = printed.find((line) => /Required:/.test(line));
  assert.match(required ?? "", /Required: --confirm-database \S+\.$/);
});

test("applying without an object store is refused before anything is stored or written", async (t) => {
  quiet(t);
  const file = await illustratedEpub(t);
  const events: string[] = [];
  const { database, committed } = fakeDatabase(events);

  await assert.rejects(
    importGutenbergBook(options(file, { apply: true, confirmDatabase: database.target.token }), dependencies(database)),
    /image storage is not enabled[\s\S]*Nothing was stored or written/,
  );
  assert.deepEqual(events, ["read"]);
  assert.deepEqual(committed, []);
});

test("images are stored and verified before the transaction opens, and the write references only those", async (t) => {
  quiet(t);
  const file = await illustratedEpub(t);
  const events: string[] = [];
  const { database, committed } = fakeDatabase(events);
  const store = recordingStore(events);

  const outcome = await importGutenbergBook(
    options(file, { apply: true, confirmDatabase: database.target.token }),
    dependencies(database, { objectStore: store }),
  );

  assert.equal(outcome.status, "applied");
  assert.deepEqual(events, [
    "read",
    "store head",
    "store put",
    "store head",
    "store get",
    "transaction",
    "apply",
    "commit",
  ]);
  const [args] = committed;
  assert.equal(args.images.length, 1);
  const [planned] = args.images;
  assert.equal(planned.sourcePath, "OEBPS/images/plate.png");
  assert.equal(planned.sourceSha256, sha(plate));
  assert.ok(args.verifiedKeys.has(planned.key));
  assert.ok(store.objects.get(planned.key)?.data.length === planned.bytes);
  // The figure written with the chapter references exactly that path.
  const figure = args.diff.chapters[0].incoming.blocks.blocks.find((block) => block.type === "figure");
  assert.deepEqual(figure && figure.type === "figure" && figure.image, {
    path: planned.sourcePath,
    mediaType: "image/png",
  });
});

test("a failing store stops the import before the transaction: nothing is committed", async (t) => {
  quiet(t);
  const file = await illustratedEpub(t);
  const events: string[] = [];
  const { database, committed } = fakeDatabase(events);
  const store = recordingStore(events);
  store.fail.put.add("*");

  await assert.rejects(
    importGutenbergBook(
      options(file, { apply: true, confirmDatabase: database.target.token }),
      dependencies(database, { objectStore: store }),
    ),
    /simulated put failure/,
  );
  assert.ok(!events.includes("transaction"));
  assert.deepEqual(committed, []);
});

test("a plan the policy refuses stores nothing", async (t) => {
  quiet(t);
  const file = await illustratedEpub(t, [
    { href: "images/plate.png", data: plate },
    { href: "images/broken.png", data: broken },
  ]);
  const events: string[] = [];
  const { database, committed } = fakeDatabase(events);
  const store = recordingStore(events);

  await assert.rejects(
    importGutenbergBook(options(file, { apply: true, confirmDatabase: database.target.token }), {
      ...dependencies(database, { objectStore: store }),
      createCodec: codec([broken]),
    }),
    (error: unknown) => {
      assert.ok(error instanceof ImportBlockedError);
      assert.match(error.message, /warning\(s\) that need a human decision/);
      return true;
    },
  );
  assert.deepEqual(events, ["read"]);
  assert.deepEqual(committed, []);
});

test("a rejected image is a warning naming edition, chapter and path; accepted, its figure has no image or asset", async (t) => {
  const printed = quiet(t);
  const file = await illustratedEpub(t, [
    { href: "images/plate.png", data: plate },
    { href: "images/broken.png", data: broken },
  ]);
  const events: string[] = [];
  const { database, committed } = fakeDatabase(events);
  const store = recordingStore(events);
  const deps = { ...dependencies(database, { objectStore: store }), createCodec: codec([broken]) };

  const dryRun = await importGutenbergBook(options(file, { acceptWarnings: true }), deps);
  // The accepted warnings are part of the plan: the flags printed for --apply repeat --accept-warnings.
  assert.ok(printed.some((line) => /Required: --confirm-database \S+ --accept-warnings\.$/.test(line)));
  assert.ok(
    printed.some((line) =>
      /WARNING: Image unavailable in Gutenberg 7, chapter 1 \("Chapter I"\): OEBPS\/images\/broken\.png — corrupt: PNG does not decode: decoder refused the stream/.test(
        line,
      ),
    ),
  );
  const applied = await importGutenbergBook(
    options(file, { apply: true, confirmDatabase: database.target.token, acceptWarnings: true }),
    deps,
  );
  assert.equal(applied.status, "applied");
  assert.ok(dryRun.status === "planned" && applied.status === "applied" && dryRun.planDigest === applied.planDigest);
  const [args] = committed;
  assert.deepEqual(
    args.images.map((item) => item.sourcePath),
    ["OEBPS/images/plate.png"],
  );
  const figures = args.diff.chapters[0].incoming.blocks.blocks.filter((block) => block.type === "figure");
  assert.deepEqual(
    figures.map((block) => block.type === "figure" && block.image?.path),
    ["OEBPS/images/plate.png", undefined],
  );
  assert.equal(store.objects.size, 1, "the rejected image was never stored");
});

test("a plan that needs images only under the lock aborts and asks for a new run; the retry stores and writes", async (t) => {
  quiet(t);
  const file = await illustratedEpub(t);
  const events: string[] = [];
  // The check before storing sees an edition already matching the EPUB (no changes, nothing stored); by the time
  // the lock is taken, its images were dissociated.
  const probe = fakeDatabase([], [emptyState]);
  await importGutenbergBook(options(file, { apply: true, confirmDatabase: probe.database.target.token }), {
    ...dependencies(probe.database, { objectStore: new MemoryObjectStore() }),
  });
  const [written] = probe.committed;
  const matching: EditionState = {
    book: { id: "book-1", slug: "illustrated-book" },
    bookAuthors: [{ id: "author-1", slug: "jane-austen", name: "Jane Austen" }],
    creatorAuthors: [],
    edition: {
      id: "edition-1",
      bookId: "book-1",
      slug: "en-gutenberg-7",
      language: "en",
      title: "Illustrated Book",
      translator: null,
      publicationYear: null,
      coverUrl: null,
      sourceUrl: "https://www.gutenberg.org/ebooks/7",
      copyrightStatus: "PENDING_REVIEW",
      publicationStatus: "DRAFT",
    },
    chapters: written.diff.chapters.map((change, index) => ({ ...change.incoming, id: `c${index}` })),
    assets: written.images.map((item) => ({
      sourcePath: item.sourcePath,
      assetId: "asset-1",
      sourceSha256: item.sourceSha256,
      codecId: item.codecId,
      maxWidth: item.maxWidth,
      sha256: item.sha256,
      objectKey: item.key,
      mediaType: item.mediaType,
      width: item.width,
      height: item.height,
      byteSize: item.bytes,
    })),
    progressChapterIds: [],
    progressRows: [],
  };
  const { database, committed } = fakeDatabase(events, [matching, { ...matching, assets: [] }]);
  const store = recordingStore(events);

  await assert.rejects(
    importGutenbergBook(
      options(file, { apply: true, confirmDatabase: database.target.token }),
      dependencies(database, { objectStore: store }),
    ),
    /needs 1 image\(s\) that were not stored and verified before the transaction; nothing was written\. Run the import again/,
  );
  assert.deepEqual(committed, []);
  assert.ok(!events.some((event) => event.startsWith("store")));

  // The retry sees the dissociated edition from the start: it stores, verifies and writes.
  const retry = fakeDatabase([], [{ ...matching, assets: [] }]);
  const outcome = await importGutenbergBook(
    options(file, { apply: true, confirmDatabase: retry.database.target.token }),
    dependencies(retry.database, { objectStore: store }),
  );
  assert.equal(outcome.status, "applied");
  assert.equal(retry.committed[0].images.length, 1);
});

test("after a write that failed, a retry verifies and reuses the object stored by the first run", async (t) => {
  quiet(t);
  const file = await illustratedEpub(t);
  const store = new MemoryObjectStore();
  const failing = fakeDatabase([]);
  const broken: ImportDatabase = {
    ...failing.database,
    write: (request, run) =>
      failing.database.write(request, (state, operations) =>
        run(state, {
          async apply(args) {
            await operations.apply(args);
            throw new Error("connection lost before commit");
          },
        }),
      ),
  };
  await assert.rejects(
    importGutenbergBook(
      options(file, { apply: true, confirmDatabase: broken.target.token }),
      dependencies(broken, { objectStore: store }),
    ),
    /connection lost/,
  );
  assert.equal(store.objects.size, 1, "the object is left, unreferenced");

  store.calls.length = 0;
  const retry = fakeDatabase([]);
  const outcome = await importGutenbergBook(
    options(file, { apply: true, confirmDatabase: retry.database.target.token }),
    dependencies(retry.database, { objectStore: store }),
  );
  assert.equal(outcome.status, "applied");
  assert.ok(!store.calls.some((call) => call.startsWith("put")), "verified and reused, not uploaded again");
  assert.ok(
    store.calls.some((call) => call.startsWith("get")),
    "read back and hashed",
  );
});
