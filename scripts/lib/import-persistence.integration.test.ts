import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test, type TestContext } from "node:test";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { books, chapters, editions } from "../../src/db/schema";
import { ChapterText } from "../../src/lib/chapter-blocks";

import {
  createDisposableDatabase,
  DISPOSABLE_POSTGRES,
  disposableTargetProblems,
  type DisposableDatabase,
} from "./disposable-postgres";
import { encodePng } from "./epub-image-fixtures";
import { buildEpub3 } from "./epub-fixtures";
import {
  assertEditionConsistent,
  createImportDatabase,
  createPostgresImportDatabase,
  EditionConsistencyError,
  ImageAssetConflictError,
  type ImportDatabase,
} from "./import-database";
import { importGutenbergBook, type ImportGutenbergOptions } from "./import-gutenberg";
import { describeDatabaseTarget } from "./import-plan";
import { removeRealStorageSettings, testImportDependencies } from "./import-test-guards";
import { MemoryObjectStore } from "./object-store-fixtures";
import { parseEpub } from "./parse-epub";
import { createSharpCodec } from "./sharp-codec";

// The import persisted in a real PostgreSQL: a throwaway database on the local disposable container, migrations
// 0000–0010 applied to it, and the importer writing through its real postgres.js implementation. Opt-in only
// (LIBRA_DISPOSABLE_POSTGRES=1, a switch, not a connection string): the target is fixed in disposable-postgres.ts and
// checked before any connection. Images go to an in-memory object store. Nothing else is contacted.

removeRealStorageSettings();

const enabled = process.env.LIBRA_DISPOSABLE_POSTGRES === "1";
const skip = enabled
  ? false
  : "set LIBRA_DISPOSABLE_POSTGRES=1 with the disposable container running (docs/epub-images.md)";

test("the harness refuses any target that is not the local disposable server", () => {
  const base = { ...DISPOSABLE_POSTGRES, database: "libra_disposable_x" };
  assert.deepEqual(disposableTargetProblems(base), []);
  for (const [target, pattern] of [
    [{ ...base, host: "db.abcdefghij.supabase.co" }, /not 127\.0\.0\.1[\s\S]*hosted service/],
    [{ ...base, host: "aws-0-eu-west-1.pooler.supabase.com" }, /not 127\.0\.0\.1/],
    [{ ...base, host: "localhost" }, /not 127\.0\.0\.1/],
    [{ ...base, host: "10.0.0.5" }, /not 127\.0\.0\.1/],
    [{ ...base, host: "8.8.8.8" }, /not 127\.0\.0\.1/],
    [{ ...base, database: "postgres" }, /not named libra_disposable_/],
    [{ ...base, database: "libra" }, /not named libra_disposable_/],
    [{ ...base, user: "postgres" }, /not a dedicated test user/],
    [{ ...base, user: "postgres.abcdefghij" }, /not a dedicated test user/],
    [{ ...base, port: 5432.5 }, /not a local unprivileged port/],
  ] as const) {
    assert.match(disposableTargetProblems(target).join("\n"), pattern, JSON.stringify(target));
  }
});

let db: DisposableDatabase;
const opened: ImportDatabase[] = [];

before(async () => {
  if (enabled) db = await createDisposableDatabase();
});
after(async () => {
  for (const database of opened) await database.close();
  if (db) await db.drop();
});

function importDatabase() {
  const database = createPostgresImportDatabase(db.url);
  opened.push(database);
  return database;
}

const sentence = (label: string) => `${label} sentence keeps the reader company. `.repeat(20).trim();
const plateA = encodePng({ width: 12, height: 8 });
const plateB = encodePng({ width: 14, height: 6 });

async function epubFile(t: TestContext, plate: Buffer, title = "Illustrated Book") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "libra-pg-"));
  t.after(async () => {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    await fs.rm(target, { recursive: true, force: true });
  });
  const file = path.join(directory, "book.epub");
  await fs.writeFile(
    file,
    await buildEpub3({
      title,
      creator: "Austen, Jane",
      documents: [
        {
          href: "chapter1.xhtml",
          body: `<h2>Chapter I</h2><p>${sentence("First")}</p><div class="figcenter"><img src="images/plate.png" alt="Plate"/></div>`,
        },
        { href: "chapter2.xhtml", body: `<h2>Chapter II</h2><p>${sentence("Second")}</p>` },
      ],
      resources: [{ href: "images/plate.png", mediaType: "image/png", data: plate }],
    }),
  );
  return file;
}

function quiet(t: TestContext) {
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
}

const store = new MemoryObjectStore();

function run(
  file: string,
  gutenbergId: string,
  slug: string,
  database: ImportDatabase,
  extra: Partial<ImportGutenbergOptions> = {},
) {
  return importGutenbergBook(
    {
      file,
      gutenbergId,
      slug,
      originalTitle: "Illustrated Book",
      originalLanguage: "en",
      apply: true,
      confirmDatabase: database.target.token,
      ...extra,
    },
    testImportDependencies({
      database,
      createCodec: async () => createSharpCodec(),
      objectStore: store,
      uploadCover: async () => "https://covers.example/covers/unused.jpg",
      revalidate: async () => true,
    }),
  );
}

const count = async (table: string, where = "true") =>
  (await db.sql.unsafe(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`))[0].n as number;

test("migration 0010: constraints, keys and delete rules behave as designed", { skip }, async () => {
  const { sql } = db;
  const [book] =
    await sql`INSERT INTO books (slug, original_title, original_language) VALUES ('constraint-book', 'C', 'en') RETURNING id`;
  const [edition] = await sql`
    INSERT INTO editions (book_id, slug, language, title, copyright_status, publication_status)
    VALUES (${book.id}, 'constraint-edition', 'en', 'C', 'PENDING_REVIEW', 'DRAFT') RETURNING id`;
  const chapter = (slug: string, blocks: unknown) =>
    sql`INSERT INTO chapters (edition_id, number, slug, title, content, blocks)
        VALUES (${edition.id}, ${slug.length}, ${slug}, ${slug}, 'Text.', ${blocks === null ? null : JSON.stringify(blocks)}::jsonb)`;

  // chapters.blocks: NULL or the version 1 envelope.
  await chapter("a", null);
  await chapter("bb", { version: 1, blocks: [] });
  await assert.rejects(chapter("ccc", { version: 2, blocks: [] }), /chapters_blocks_envelope_check/);
  await assert.rejects(chapter("dddd", { version: 1, blocks: {} }), /chapters_blocks_envelope_check/);

  const hex = (digit: string) => digit.repeat(64);
  const asset = (overrides: Record<string, unknown> = {}) => {
    const row = {
      source_sha256: hex("1"),
      codec_id: "codec",
      max_width: 1600,
      sha256: hex("2"),
      object_key: `illustrations/${hex("2")}.png`,
      media_type: "image/png",
      width: 10,
      height: 5,
      byte_size: 100,
      ...overrides,
    };
    return sql`INSERT INTO image_assets ${sql(row)} RETURNING id`;
  };
  const [created] = await asset();
  await assert.rejects(asset(), /image_assets_identity_idx/);
  // Uppercase hex with a key that matches it: only the digest format is wrong.
  await assert.rejects(
    asset({ source_sha256: hex("3"), sha256: hex("A"), object_key: `illustrations/${hex("A")}.png` }),
    /image_assets_sha256_check/,
  );
  await assert.rejects(
    asset({ source_sha256: hex("3"), object_key: `illustrations/${hex("9")}.png` }),
    /image_assets_object_key_check/,
  );
  await assert.rejects(asset({ source_sha256: hex("3"), media_type: "image/gif" }), /image_assets_media_type_check/);
  await assert.rejects(asset({ source_sha256: hex("3"), width: 2000 }), /image_assets_dimensions_check/);

  const link = (sourcePath: string) =>
    sql`INSERT INTO edition_assets (edition_id, asset_id, source_path) VALUES (${edition.id}, ${created.id}, ${sourcePath})`;
  await link("OEBPS/images/a.png");
  await assert.rejects(link("OEBPS/images/a.png"), /edition_assets_edition_source_path_idx/);
  for (const bad of ["../a.png", "/etc/a.png", "OEBPS//a.png", "https://x/a.png", "OEBPS\\a.png"]) {
    await assert.rejects(link(bad), /edition_assets_source_path_check/, bad);
  }

  // An associated asset cannot be deleted; deleting the edition removes its associations, never the asset.
  await assert.rejects(
    sql`DELETE FROM image_assets WHERE id = ${created.id}`,
    /edition_assets_asset_id_image_assets_id_fk/,
  );
  await sql`DELETE FROM editions WHERE id = ${edition.id}`;
  assert.equal(await count("edition_assets", `asset_id = '${created.id}'`), 0);
  assert.equal(await count("image_assets", `id = '${created.id}'`), 1);
  await sql`DELETE FROM image_assets WHERE id = ${created.id}`;
});

test(
  "an illustrated EPUB is imported: blocks, asset and association written together, and a retry changes nothing",
  { skip },
  async (t) => {
    quiet(t);
    const file = await epubFile(t, plateA);
    const outcome = await run(file, "7", "illustrated-book", importDatabase());
    assert.equal(outcome.status, "applied");

    const [edition] = await db.sql`SELECT id FROM editions WHERE source_identifier = '7'`;
    const chapters =
      await db.sql`SELECT slug, content, blocks FROM chapters WHERE edition_id = ${edition.id} ORDER BY number`;
    assert.equal(chapters.length, 2);
    assert.ok(chapters.every((row) => row.blocks !== null));
    const associations = await db.sql`
    SELECT ea.source_path, ia.object_key FROM edition_assets ea JOIN image_assets ia ON ia.id = ea.asset_id
    WHERE ea.edition_id = ${edition.id}`;
    assert.deepEqual(
      associations.map((row) => row.source_path),
      ["OEBPS/images/plate.png"],
    );
    assert.ok(store.objects.has(associations[0].object_key), "the referenced object is in the store");

    const again = await run(file, "7", "illustrated-book", importDatabase());
    assert.equal(again.status, "unchanged");
    assert.equal(await count("edition_assets", `edition_id = '${edition.id}'`), 1);
  },
);

test(
  "two editions with the same image, imported at once, share one asset with an association each",
  { skip },
  async (t) => {
    quiet(t);
    // An image no earlier test stored: both transactions insert the same new identity, one waits for the other.
    const shared = encodePng({ width: 11, height: 11 });
    const [first, second] = await Promise.all([epubFile(t, shared, "Shared One"), epubFile(t, shared, "Shared Two")]);
    const before = await count("image_assets");
    const outcomes = await Promise.all([
      run(first, "11", "shared-one", importDatabase()),
      run(second, "12", "shared-two", importDatabase()),
    ]);
    assert.deepEqual(
      outcomes.map((outcome) => outcome.status),
      ["applied", "applied"],
    );
    assert.equal((await count("image_assets")) - before, 1, "one asset for both editions");
    const links = await db.sql`
    SELECT e.source_identifier, ea.asset_id FROM edition_assets ea JOIN editions e ON e.id = ea.edition_id
    WHERE e.source_identifier IN ('11', '12') ORDER BY e.source_identifier`;
    assert.equal(links.length, 2);
    assert.equal(links[0].asset_id, links[1].asset_id);
  },
);

test(
  "a new image for one edition changes its association only; the old asset and other editions stay",
  { skip },
  async (t) => {
    quiet(t);
    const [original, changed] = await Promise.all([epubFile(t, plateA, "Changing"), epubFile(t, plateB, "Changing")]);
    await run(original, "13", "changing", importDatabase());
    const [before] = await db.sql`
    SELECT ea.asset_id FROM edition_assets ea JOIN editions e ON e.id = ea.edition_id WHERE e.source_identifier = '13'`;
    const others = await db.sql`
    SELECT ea.edition_id, ea.asset_id FROM edition_assets ea JOIN editions e ON e.id = ea.edition_id
    WHERE e.source_identifier IN ('11', '12') ORDER BY ea.edition_id`;

    const outcome = await run(changed, "13", "changing", importDatabase());
    assert.equal(outcome.status, "applied");
    assert.ok(outcome.status === "applied" && outcome.diff.totals.imagesChanged === 1);
    const [after] = await db.sql`
    SELECT ea.asset_id FROM edition_assets ea JOIN editions e ON e.id = ea.edition_id WHERE e.source_identifier = '13'`;
    assert.notEqual(after.asset_id, before.asset_id);
    assert.equal(await count("image_assets", `id = '${before.asset_id}'`), 1, "the old asset is never deleted");
    assert.deepEqual(
      await db.sql`
      SELECT ea.edition_id, ea.asset_id FROM edition_assets ea JOIN editions e ON e.id = ea.edition_id
      WHERE e.source_identifier IN ('11', '12') ORDER BY ea.edition_id`,
      others,
    );
  },
);

test("a failure inside the transaction rolls back everything; the retry converges", { skip }, async (t) => {
  quiet(t);
  const file = await epubFile(t, plateB, "Rolled Back");
  const real = importDatabase();
  const failing: ImportDatabase = {
    ...real,
    write: (request, body) =>
      real.write(request, (state, operations) =>
        body(state, {
          async apply(args) {
            await operations.apply(args);
            throw new Error("connection lost before commit");
          },
        }),
      ),
  };
  await assert.rejects(run(file, "14", "rolled-back", failing), /connection lost/);
  assert.equal(await count("editions", "source_identifier = '14'"), 0);
  assert.equal(await count("books", "slug = 'rolled-back'"), 0);

  const outcome = await run(file, "14", "rolled-back", importDatabase());
  assert.equal(outcome.status, "applied");
  assert.equal(
    await count("edition_assets ea JOIN editions e ON e.id = ea.edition_id", "e.source_identifier = '14'"),
    1,
  );
});

test(
  "an existing asset of the same identity with other bytes stops the import and writes nothing",
  { skip },
  async (t) => {
    quiet(t);
    const odd = encodePng({ width: 15, height: 9 });
    const file = await epubFile(t, odd, "Conflicting");
    // What the importer would compute for this image, then the same identity planted with other bytes.
    const codec = createSharpCodec();
    const { createHash } = await import("node:crypto");
    const source = createHash("sha256").update(odd).digest("hex");
    const wrong = "e".repeat(64);
    await db.sql`
    INSERT INTO image_assets (source_sha256, codec_id, max_width, sha256, object_key, media_type, width, height, byte_size)
    VALUES (${source}, ${codec.id}, 1600, ${wrong}, ${`illustrations/${wrong}.png`}, 'image/png', 15, 9, 1)`;

    await assert.rejects(run(file, "15", "conflicting", importDatabase()), ImageAssetConflictError);
    assert.equal(await count("editions", "source_identifier = '15'"), 0);
  },
);

test("chapters imported before blocks keep working, and a reimport adds their blocks", { skip }, async (t) => {
  quiet(t);
  const file = await epubFile(t, plateA, "Legacy Book");
  await run(file, "16", "legacy-book", importDatabase());
  const [edition] = await db.sql`SELECT id FROM editions WHERE source_identifier = '16'`;
  // As if imported before blocks existed.
  await db.sql`DELETE FROM edition_assets WHERE edition_id = ${edition.id}`;
  await db.sql`UPDATE chapters SET blocks = NULL WHERE edition_id = ${edition.id}`;

  const state = await importDatabase().readState({ bookSlug: "legacy-book", gutenbergId: "16", creatorSlugs: [] });
  assert.ok(state.chapters.every((chapter) => chapter.blocks === null));

  const outcome = await run(file, "16", "legacy-book", importDatabase());
  assert.equal(outcome.status, "applied");
  assert.ok(outcome.status === "applied" && outcome.diff.totals.blocksChanges === 2);
  assert.equal(await count("chapters", `edition_id = '${edition.id}' AND blocks IS NULL`), 0);
  assert.equal(await count("edition_assets", `edition_id = '${edition.id}'`), 1);
});

test(
  "the check before commit refuses a figure without an association inside a real transaction",
  { skip },
  async () => {
    const client = postgres(db.url, { max: 1, ssl: false, onnotice: () => {} });
    try {
      const orm = drizzle(client);
      await assert.rejects(
        orm.transaction(async (tx) => {
          const [book] = await tx
            .insert(books)
            .values({ slug: "orphan-book", originalTitle: "O", originalLanguage: "en" })
            .returning({ id: books.id });
          const [edition] = await tx
            .insert(editions)
            .values({
              bookId: book.id,
              slug: "orphan",
              language: "en",
              title: "O",
              copyrightStatus: "PENDING_REVIEW",
              publicationStatus: "DRAFT",
            })
            .returning({ id: editions.id });
          const text = ChapterText.withBlocks("Text.", {
            version: 1,
            blocks: [
              { type: "paragraph", content: [{ text: "Text." }] },
              {
                type: "figure",
                image: { path: "OEBPS/images/none.png", mediaType: "image/png" },
                alt: "",
                caption: [],
              },
            ],
          });
          await tx
            .insert(chapters)
            .values({ editionId: edition.id, number: 1, slug: "one", title: "One", ...text.columns() });
          await assertEditionConsistent(tx, edition.id, new Map());
        }),
        (error: unknown) => {
          assert.ok(error instanceof EditionConsistencyError);
          assert.match(error.message, /OEBPS\/images\/none\.png has no association/);
          return true;
        },
      );
      assert.equal(await count("books", "slug = 'orphan-book'"), 0, "rolled back");
    } finally {
      await client.end();
    }
  },
);

/*
 * The identity race, made deterministic. Transaction A holds an uncommitted image_assets row on its own connection;
 * import B, through the real write transaction (READ COMMITTED), reaches the INSERT ... ON CONFLICT DO NOTHING of the
 * same identity. B waiting on A is proven from PostgreSQL itself (pg_stat_activity and pg_blocking_pids), never
 * assumed from timing; only then does A commit or roll back. Every wait has a time limit.
 */

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms: ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, limit]);
  } finally {
    clearTimeout(timer);
  }
}

/** Polls a PostgreSQL condition until it holds; false when the limit passes first. */
async function eventually(check: () => Promise<boolean>, ms: number) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

/** The backends waiting on a lock held by `holder` while inserting into image_assets (quoted or not). */
async function insertsBlockedBy(holder: number) {
  return db.sql`
    SELECT pid FROM pg_stat_activity
    WHERE datname = current_database()
      AND wait_event_type = 'Lock'
      AND query ~* '^[[:space:]]*insert[[:space:]]+into[[:space:]]+"?image_assets"?'
      AND ${holder}::int = ANY(pg_blocking_pids(pid))`;
}

/**
 * Ends A before B: B may still be blocked on A's row, and anything queued on B's connection would wait for it.
 * Ending A's connection aborts its transaction if it is still open.
 */
async function endInOrder(a: postgres.ReservedSql, clientA: postgres.Sql, clientB: postgres.Sql) {
  await a.unsafe("ROLLBACK").catch(() => {});
  a.release();
  await clientA.end({ timeout: 5 });
  await clientB.end({ timeout: 5 });
}

/** What the importer will compute for the only image of `file`: the identity and bytes A plants. */
async function plannedImage(file: string) {
  const parsed = await parseEpub(await fs.readFile(file), {}, { codec: createSharpCodec() });
  assert.equal(parsed.images?.length, 1);
  return parsed.images![0];
}

async function race(t: TestContext, ending: "COMMIT" | "ROLLBACK", plate: Buffer, gutenbergId: string) {
  quiet(t);
  const file = await epubFile(t, plate, `Race ${ending}`);
  const image = await plannedImage(file);

  // A: the planted identity, left uncommitted on a reserved connection.
  const clientA = postgres(db.url, { max: 1, ssl: false, onnotice: () => {} });
  const a = await clientA.reserve();
  const queriesB: string[] = [];
  const clientB = postgres(db.url, {
    max: 1,
    ssl: false,
    prepare: false,
    onnotice: () => {},
    debug: (_connection, query) => queriesB.push(query),
  });
  try {
    await a`BEGIN`;
    const [{ pid: holder }] = await a`SELECT pg_backend_pid() AS pid`;
    const [planted] = await a`
      INSERT INTO image_assets (source_sha256, codec_id, max_width, sha256, object_key, media_type, width, height, byte_size)
      VALUES (${image.sourceSha256}, ${image.codec}, ${image.maxWidth}, ${image.sha256}, ${image.key},
              ${image.mediaType}, ${image.width}, ${image.height}, ${image.bytes})
      RETURNING id`;

    // B: the real import, through the real write transaction, on its own connection. Each of its transactions first
    // reports the isolation PostgreSQL applies to it, read after drizzle has set the importer's configuration.
    const ormB = drizzle(clientB);
    const isolationsB: string[] = [];
    type Transaction = typeof ormB.transaction;
    const observedB: typeof ormB = Object.assign(Object.create(ormB), {
      transaction: ((body: Parameters<Transaction>[0], config?: Parameters<Transaction>[1]) =>
        ormB.transaction(async (tx) => {
          const [row] = await tx.execute<{ isolation: string }>(
            sql`SELECT current_setting('transaction_isolation') AS isolation`,
          );
          isolationsB.push(row.isolation);
          return body(tx);
        }, config)) as Transaction,
    });
    const databaseB = createImportDatabase(observedB, describeDatabaseTarget(db.url), async () => {});
    let settled = false;
    const outcomeB = run(file, gutenbergId, `race-${ending.toLowerCase()}`, databaseB).then(
      (outcome) => {
        settled = true;
        return { outcome, error: null as unknown };
      },
      (error: unknown) => {
        settled = true;
        return { outcome: null, error };
      },
    );

    const waited = await eventually(async () => (await insertsBlockedBy(holder)).length === 1, 15_000);
    assert.ok(waited, "B never waited on A's uncommitted row: the race was not exercised");
    assert.equal(settled, false, "B finished while A still held the row");

    await a.unsafe(ending);
    const { outcome, error } = await withTimeout(outcomeB, 30_000, "import B after A ended");
    assert.equal(error, null, String(error));
    assert.equal(outcome?.status, "applied");

    // Inside PostgreSQL: B's read-only check ran under REPEATABLE READ and its write under READ COMMITTED.
    assert.deepEqual(isolationsB, ["repeatable read", "read committed"]);
    // And the statements the client sent for them.
    assert.ok(queriesB.includes("set transaction isolation level read committed"));
    assert.ok(queriesB.includes("set transaction isolation level repeatable read read only"));

    const rows = await db.sql`
      SELECT id, sha256, object_key FROM image_assets
      WHERE source_sha256 = ${image.sourceSha256} AND codec_id = ${image.codec} AND max_width = ${image.maxWidth}`;
    assert.equal(rows.length, 1, "exactly one asset for the identity");
    assert.equal(rows[0].sha256, image.sha256);
    assert.equal(rows[0].object_key, image.key);
    const links = await db.sql`
      SELECT ea.asset_id FROM edition_assets ea JOIN editions e ON e.id = ea.edition_id
      WHERE e.source_identifier = ${gutenbergId}`;
    assert.equal(links.length, 1);
    assert.equal(links[0].asset_id, rows[0].id);
    if (ending === "COMMIT") assert.equal(rows[0].id, planted.id, "B reused the row A committed");
    else assert.notEqual(rows[0].id, planted.id, "A's row was rolled back; B inserted its own");
  } finally {
    await endInOrder(a, clientA, clientB);
  }
}

// A test-level limit on top of the waits inside: a race test can never hang the run.
const RACE_TIMEOUT = 90_000;

test(
  "identity race: B waits on A's uncommitted asset and, after A commits, reuses it under READ COMMITTED",
  { skip, timeout: RACE_TIMEOUT },
  (t) => race(t, "COMMIT", encodePng({ width: 17, height: 13 }), "31"),
);

test(
  "identity race: B waits on A's uncommitted asset and, after A rolls back, inserts its own",
  { skip, timeout: RACE_TIMEOUT },
  (t) => race(t, "ROLLBACK", encodePng({ width: 19, height: 7 }), "32"),
);

test(
  "control: the same race under REPEATABLE READ cannot read the winner, so the isolation level is what makes it work",
  { skip, timeout: RACE_TIMEOUT },
  async () => {
    const source = "c".repeat(64);
    const digest = "d".repeat(64);
    const row = {
      source_sha256: source,
      codec_id: "race-control",
      max_width: 1600,
      sha256: digest,
      object_key: `illustrations/${digest}.png`,
      media_type: "image/png",
      width: 10,
      height: 5,
      byte_size: 100,
    };
    const clientA = postgres(db.url, { max: 1, ssl: false, onnotice: () => {} });
    const clientB = postgres(db.url, { max: 1, ssl: false, onnotice: () => {} });
    const a = await clientA.reserve();
    const b = await clientB.reserve();
    try {
      await a`BEGIN`;
      const [{ pid: holder }] = await a`SELECT pg_backend_pid() AS pid`;
      await a`INSERT INTO image_assets ${a(row)}`;

      // B takes its snapshot before A commits, as an import's write transaction would.
      await b`BEGIN ISOLATION LEVEL REPEATABLE READ`;
      await b`SELECT 1`;
      const inserted = b`
        INSERT INTO image_assets ${b(row)}
        ON CONFLICT (source_sha256, codec_id, max_width) DO NOTHING RETURNING id`.then(
        (rows) => ({ rows: [...rows], error: null as unknown }),
        (error: unknown) => ({ rows: null, error }),
      );
      const waited = await eventually(async () => (await insertsBlockedBy(holder)).length === 1, 15_000);
      assert.ok(waited, "B never waited on A's uncommitted row");
      await a`COMMIT`;

      const { rows, error } = await withTimeout(inserted, 15_000, "control insert after A committed");
      if (error) {
        // PostgreSQL refuses: the conflicting row is not in B's snapshot.
        assert.equal((error as { code?: string }).code, "40001", String(error));
      } else {
        assert.deepEqual(rows, []);
        const seen = await b`SELECT id FROM image_assets WHERE source_sha256 = ${source} AND codec_id = 'race-control'`;
        assert.equal(seen.length, 0, "the winner is invisible to B's snapshot");
      }
    } finally {
      // A first, so B is no longer blocked when its own rollback is sent.
      await a.unsafe("ROLLBACK").catch(() => {});
      a.release();
      await clientA.end({ timeout: 5 });
      await withTimeout(b.unsafe("ROLLBACK"), 10_000, "control rollback").catch(() => {});
      b.release();
      await clientB.end({ timeout: 5 });
    }
  },
);
