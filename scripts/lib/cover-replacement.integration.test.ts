import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test, type TestContext } from "node:test";

import postgres from "postgres";

import { parseMediaBase } from "./cover-origin-migration";
import { applyCoverReplacement, planCoverReplacement } from "./cover-replacement";
import { createCoverReplacementStore, type CoverReplacementStore } from "./cover-replacement-store";
import { isCustomCoverUrl } from "./custom-cover";
import { createDisposableDatabase, type DisposableDatabase } from "./disposable-postgres";
import { encodePng } from "./epub-image-fixtures";
import { buildEpub3 } from "./epub-fixtures";
import { createPostgresImportDatabase, type ImportDatabase } from "./import-database";
import { importGutenbergBook, type ImportGutenbergOptions } from "./import-gutenberg";
import { removeRealStorageSettings, testImportDependencies } from "./import-test-guards";
import { coverKeyFor, type uploadCover } from "./r2";
import { createSharpCodec } from "./sharp-codec";

// The SQL of `pnpm db:replace-cover` (cover-replacement-store.ts) and the importer, persisted in a real PostgreSQL: a
// throwaway database on the local disposable container (disposable-postgres.ts, docs/epub-images.md), migrations
// applied. Opt-in only (LIBRA_DISPOSABLE_POSTGRES=1); the target is fixed and checked before any connection. R2 and
// the cache are in-memory doubles. Each test imports its own books under its own Gutenberg ids, so tests share the
// database without sharing rows; the database is dropped at the end.

removeRealStorageSettings();

const enabled = process.env.LIBRA_DISPOSABLE_POSTGRES === "1";
const skip = enabled
  ? false
  : "set LIBRA_DISPOSABLE_POSTGRES=1 with the disposable container running (docs/epub-images.md)";

const base = parseMediaBase("https://covers.example.com", "R2_PUBLIC_URL");
const coverA = encodePng({ width: 4, height: 6 });
const coverB = encodePng({ width: 6, height: 9 });
const custom = encodePng({ width: 8, height: 12 });

let db: DisposableDatabase;
let client: postgres.Sql;
const opened: ImportDatabase[] = [];

before(async () => {
  if (!enabled) return;
  db = await createDisposableDatabase();
  // The replacement's own connection, as in scripts/replace-cover.ts.
  client = postgres(db.url, { max: 1, prepare: false, ssl: false, onnotice: () => {} });
});
after(async () => {
  for (const database of opened) await database.close();
  if (client) await client.end();
  if (db) await db.drop();
});

function quiet(t: TestContext) {
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
}

async function epub(t: TestContext, { cover, text = "First" }: { cover: Buffer | null; text?: string }) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "libra-cover-pg-"));
  t.after(async () => {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    await fs.rm(target, { recursive: true, force: true });
  });
  const sentence = (label: string) => `${label} sentence keeps the reader company. `.repeat(20).trim();
  const file = path.join(directory, "book.epub");
  await fs.writeFile(
    file,
    await buildEpub3({
      title: "Cover Book",
      creator: "Bronte, Emily",
      documents: [
        { href: "chapter1.xhtml", body: `<h2>Chapter I</h2><p>${sentence(text)}</p>` },
        { href: "chapter2.xhtml", body: `<h2>Chapter II</h2><p>${sentence("Second")}</p>` },
      ],
      resources: cover ? [{ href: "cover.png", mediaType: "image/png", data: cover, properties: "cover-image" }] : [],
    }),
  );
  return file;
}

/** The importer against the disposable database, with R2 and the cache as recording doubles. */
function importer() {
  const database = createPostgresImportDatabase(db.url);
  opened.push(database);
  const uploads: string[] = [];
  let beforeUpload: () => Promise<void> = async () => {};

  const run = (file: string, gutenbergId: string, slug: string, extra: Partial<ImportGutenbergOptions> = {}) =>
    importGutenbergBook(
      {
        file,
        gutenbergId,
        slug,
        originalTitle: "Cover Book",
        originalLanguage: "en",
        apply: true,
        confirmDatabase: database.target.token,
        acceptWarnings: true,
        ...extra,
      },
      testImportDependencies({
        database,
        createCodec: async () => createSharpCodec(),
        // Called inside the importer's transaction, with the edition row locked.
        uploadCover: async (input: Parameters<typeof uploadCover>[0]) => {
          await beforeUpload();
          const key = coverKeyFor(input);
          uploads.push(key);
          return `${base.href}/${key}`;
        },
        revalidate: async () => true,
      }),
    );

  return {
    run,
    uploads,
    onUpload(hook: () => Promise<void>) {
      beforeUpload = hook;
    },
  };
}

/** `pnpm db:replace-cover --apply` through its real store, with R2 and the cache as recording doubles. */
async function replace(
  gutenbergId: string,
  slug: string,
  {
    data = custom,
    expectedCurrent,
    wrap,
    onUpload,
  }: {
    data?: Buffer;
    /** --expect-current; by default the cover read just before, as a reviewed dry run would give. */
    expectedCurrent?: string | null;
    wrap?: (inner: CoverReplacementStore["withLockedEdition"]) => CoverReplacementStore["withLockedEdition"];
    onUpload?: () => Promise<void>;
  } = {},
) {
  const store = createCoverReplacementStore(client, gutenbergId);
  const edition = await store.read();
  const image = { extension: "png", mediaType: "image/png" };
  const plan = planCoverReplacement({ edition, expectedBook: slug, data, image, publicBase: base, expectedBase: base });
  const uploads: string[] = [];
  const revalidations: string[][] = [];
  const outcome = applyCoverReplacement(
    {
      plan,
      edition,
      expectedBook: slug,
      expectedCurrent: expectedCurrent === undefined ? edition.coverUrl : expectedCurrent,
      data,
      image,
      publicBase: base,
      expectedBase: base,
    },
    {
      upload: async (input) => {
        if (onUpload) await onUpload();
        const key = coverKeyFor(input);
        uploads.push(key);
        return `${base.href}/${key}`;
      },
      withLockedEdition: wrap ? wrap(store.withLockedEdition) : store.withLockedEdition,
      revalidate: async (tags) => {
        revalidations.push(tags);
        return true;
      },
      log: () => {},
      error: () => {},
    },
  );
  // Handled from the start: a concurrent test may reject it before it is awaited.
  outcome.catch(() => {});
  return { plan, uploads, revalidations, outcome };
}

const editionRow = async (gutenbergId: string) => {
  const [row] = await db.sql`
    SELECT * FROM editions WHERE source_name = 'Project Gutenberg' AND source_identifier = ${gutenbergId}`;
  assert.ok(row, `edition ${gutenbergId}`);
  return row;
};
const chaptersOf = async (editionId: string) =>
  db.sql`SELECT id, number, slug, title, content, blocks FROM chapters WHERE edition_id = ${editionId} ORDER BY number`;
const withoutCover = (row: Record<string, unknown>) => {
  const rest = { ...row };
  delete rest.cover_url;
  delete rest.updated_at;
  return rest;
};

/** Waits until another session of this database is blocked on a lock, proving the two runs contend for the row. */
async function waitForLockWaiter() {
  for (let attempt = 0; attempt < 400; attempt++) {
    const [{ waiting }] = await db.sql`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (waiting > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("No session waited for the edition's row lock.");
}

test(
  "1. a replacement writes exactly the expected edition: its cover_url and updated_at, nothing else",
  { skip },
  async (t) => {
    quiet(t);
    const books = importer();
    assert.equal((await books.run(await epub(t, { cover: coverA }), "9101", "cover-one")).status, "applied");
    assert.equal((await books.run(await epub(t, { cover: coverA }), "9102", "cover-one-hound")).status, "applied");
    const before = await editionRow("9101");
    const hound = await editionRow("9102");
    const chapters = await chaptersOf(before.id);

    const { plan, outcome, revalidations } = await replace("9101", "cover-one");
    assert.equal(await outcome, "applied");

    const after = await editionRow("9101");
    assert.equal(after.cover_url, plan.url);
    assert.ok(isCustomCoverUrl(after.cover_url));
    assert.deepEqual(withoutCover(after), withoutCover(before), "no other column of the edition changed");
    assert.ok(after.updated_at >= before.updated_at);
    assert.deepEqual(await chaptersOf(before.id), chapters, "chapters untouched");
    assert.deepEqual(await editionRow("9102"), hound, "the other book's edition is untouched");
    assert.deepEqual(revalidations, [["library", "book:cover-one"]]);

    // Rerun with the anchor of the first dry run: already applied, nothing uploaded or written.
    const again = await replace("9101", "cover-one", { expectedCurrent: before.cover_url });
    assert.equal(await again.outcome, "unchanged");
    assert.deepEqual(again.uploads, []);
    assert.deepEqual(await editionRow("9101"), after);
  },
);

test(
  "2. a cover that changes after it was read is not overwritten (B3 anchor, checked under the lock)",
  { skip },
  async (t) => {
    quiet(t);
    const books = importer();
    await books.run(await epub(t, { cover: coverA }), "9103", "cover-two");
    const read = await editionRow("9103");
    const other = `${base.href}/covers/cover-two-9103-ffffffffffff.png`;

    // Changed between the read and the lock: the run's own read is stale, the locked row is not.
    const stale = await replace("9103", "cover-two", {
      onUpload: async () => {
        await db.sql`UPDATE editions SET cover_url = ${other} WHERE id = ${read.id}`;
      },
    });
    await assert.rejects(stale.outcome, /changed since it was read/);
    assert.equal((await editionRow("9103")).cover_url, other);
    assert.deepEqual(stale.revalidations, []);

    // Changed between the dry run and --apply: refused before anything is uploaded.
    const anchored = await replace("9103", "cover-two", { expectedCurrent: read.cover_url });
    await assert.rejects(anchored.outcome, /not the expected[\s\S]*Nothing was uploaded or written/);
    assert.deepEqual(anchored.uploads, []);
    assert.deepEqual(anchored.revalidations, []);
    assert.equal((await editionRow("9103")).cover_url, other);
  },
);

test("3. a transaction that fails after the UPDATE ran is rolled back", { skip }, async (t) => {
  quiet(t);
  const books = importer();
  await books.run(await epub(t, { cover: coverA }), "9104", "cover-three");
  const before = await editionRow("9104");

  const failing = await replace("9104", "cover-three", {
    wrap: (inner) => (write) =>
      inner((edition, update) =>
        write(edition, async (url, previousUrl) => {
          assert.equal(await update(url, previousUrl), 1, "the real UPDATE matched the row");
          throw new Error("connection reset after the update");
        }),
      ),
  });
  await assert.rejects(failing.outcome, /connection reset after the update/);
  assert.deepEqual(await editionRow("9104"), before, "rolled back: cover_url and updated_at as before");
  assert.deepEqual(failing.revalidations, []);

  // The retry writes it, under the same key.
  const retry = await replace("9104", "cover-three");
  assert.equal(await retry.outcome, "applied");
  assert.deepEqual(retry.uploads, failing.uploads);
  assert.equal((await editionRow("9104")).cover_url, retry.plan.url);
});

test("4a. an import waits for a replacement holding the row, then keeps its custom cover", { skip }, async (t) => {
  quiet(t);
  const books = importer();
  await books.run(await epub(t, { cover: coverA }), "9105", "cover-four");
  const reimport = await epub(t, { cover: coverB });
  let imported: ReturnType<typeof books.run> | undefined;

  const replacement = await replace("9105", "cover-four", {
    wrap: (inner) => (write) =>
      inner(async (edition, update) => {
        // The replacement holds the row: the import must wait for it.
        imported = books.run(reimport, "9105", "cover-four");
        imported.catch(() => {});
        await waitForLockWaiter();
        await write(edition, update);
      }),
  });
  assert.equal(await replacement.outcome, "applied");
  const outcome = await imported!;

  // Decided again under the lock, after the replacement committed: the custom cover is kept.
  assert.equal(outcome.status, "unchanged");
  assert.deepEqual(books.uploads.slice(1), [], "the import uploaded no cover");
  assert.equal((await editionRow("9105")).cover_url, replacement.plan.url);
});

test(
  "4b. a replacement waits for an import holding the row, then refuses to overwrite its cover",
  { skip },
  async (t) => {
    quiet(t);
    const books = importer();
    await books.run(await epub(t, { cover: coverA }), "9106", "cover-five");
    const before = await editionRow("9106");
    let replacement: Awaited<ReturnType<typeof replace>> | undefined;

    // The import uploads its new cover with the edition row locked; the replacement starts then and must wait.
    books.onUpload(async () => {
      books.onUpload(async () => {});
      replacement = await replace("9106", "cover-five", { expectedCurrent: before.cover_url });
      await waitForLockWaiter();
    });
    const outcome = await books.run(await epub(t, { cover: coverB }), "9106", "cover-five");
    assert.equal(outcome.status, "applied");
    const imported = (await editionRow("9106")).cover_url;
    assert.notEqual(imported, before.cover_url);

    await assert.rejects(replacement!.outcome, /changed since it was read/);
    assert.equal((await editionRow("9106")).cover_url, imported, "the import's cover stands; no contradictory write");
    assert.deepEqual(replacement!.revalidations, []);
  },
);

test("5. a re-import under a real transaction keeps a covers/libra/ cover and writes nothing", { skip }, async (t) => {
  quiet(t);
  const books = importer();
  const file = await epub(t, { cover: coverA });
  await books.run(file, "9107", "cover-six");
  const { plan, outcome } = await replace("9107", "cover-six");
  await outcome;
  const replaced = await editionRow("9107");
  const uploads = books.uploads.length;

  const reimport = await books.run(file, "9107", "cover-six");
  assert.equal(reimport.status, "unchanged");
  assert.deepEqual("diff" in reimport && reimport.diff.customCover, { url: plan.url, action: "kept" });
  assert.equal(books.uploads.length, uploads, "no cover uploaded");
  assert.deepEqual(await editionRow("9107"), replaced, "the row is untouched, updated_at included");
});

test("6. a re-import that changes chapters still keeps the custom cover", { skip }, async (t) => {
  quiet(t);
  const books = importer();
  await books.run(await epub(t, { cover: coverA }), "9108", "cover-seven");
  const { plan, outcome } = await replace("9108", "cover-seven");
  await outcome;
  const uploads = books.uploads.length;

  const reimport = await books.run(await epub(t, { cover: coverB, text: "Revised" }), "9108", "cover-seven");
  assert.equal(reimport.status, "applied");
  const after = await editionRow("9108");
  assert.equal(after.cover_url, plan.url);
  assert.equal(books.uploads.length, uploads, "no cover uploaded");
  const [first] = await chaptersOf(after.id);
  assert.match(String(first.content), /Revised sentence/);
});

test("7. --replace-custom-cover replaces the custom cover with the EPUB's", { skip }, async (t) => {
  quiet(t);
  const books = importer();
  await books.run(await epub(t, { cover: coverA }), "9109", "cover-eight");
  await (
    await replace("9109", "cover-eight")
  ).outcome;

  const reimport = await books.run(await epub(t, { cover: coverB }), "9109", "cover-eight", {
    replaceCustomCover: true,
  });
  assert.equal(reimport.status, "applied");
  const after = await editionRow("9109");
  assert.equal(after.cover_url, `${base.href}/${books.uploads.at(-1)}`);
  assert.equal(isCustomCoverUrl(after.cover_url), false);
});

test("B3: an edition without a cover is replaced only with --expect-current none", { skip }, async (t) => {
  quiet(t);
  const books = importer();
  await books.run(await epub(t, { cover: null }), "9110", "cover-nine");
  assert.equal((await editionRow("9110")).cover_url, null);

  const wrong = await replace("9110", "cover-nine", { expectedCurrent: `${base.href}/covers/x-1-000000000000.png` });
  await assert.rejects(wrong.outcome, /current cover is none/);
  assert.deepEqual(wrong.uploads, []);
  assert.equal((await editionRow("9110")).cover_url, null);

  const right = await replace("9110", "cover-nine", { expectedCurrent: null });
  assert.equal(await right.outcome, "applied");
  assert.equal((await editionRow("9110")).cover_url, right.plan.url);
});
