import assert from "node:assert/strict";
import { test } from "node:test";

import { drizzle } from "drizzle-orm/pg-proxy";
import { drizzle as postgresJsDrizzle } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";

import {
  createImportDatabase,
  createOperations,
  loadState,
  WRITE_TRANSACTION,
  type Transaction,
} from "./import-database";
import { buildImportDiff, describeDatabaseTarget, type PlanInput } from "./import-plan";
import type { EditionState, StateRequest } from "./import-state";

// The real drizzle query builders generate the SQL; a pg-proxy driver records it and returns fixture rows.
// No connection of any kind is opened.

interface Statement {
  sql: string;
  params: unknown[];
}

function fakeTransaction(respond: (sql: string) => unknown[][] = () => []) {
  const statements: Statement[] = [];
  const db = drizzle(async (sql, params) => {
    statements.push({ sql, params });
    return { rows: respond(sql) };
  });

  return { tx: db as unknown as Transaction, statements };
}

const request: StateRequest = { bookSlug: "test-book", gutenbergId: "7", creatorSlugs: ["jane-austen"] };

const editionRow = [
  "edition-1",
  "book-1",
  "en-gutenberg-7",
  "en",
  "Test Book",
  null,
  null,
  "https://covers.example/covers/old.jpg",
  "https://www.gutenberg.org/ebooks/7",
  "PUBLIC_DOMAIN_VERIFIED",
  "PUBLISHED",
];
// chapters columns: id, edition_id, number, slug, title, content, blocks, word_count, created_at, updated_at
const chapterRow = (id: string, number: number, slug: string, content = `${slug} text`) => [
  id,
  "edition-1",
  number,
  slug,
  slug,
  content,
  null,
  3,
  "2026-01-01T00:00:00Z",
  "2026-01-01T00:00:00Z",
];

function readResponder(sql: string): unknown[][] {
  if (/from "book_authors"/.test(sql)) return [["author-1", "jane-austen", "Jane Austen"]];
  if (/from "authors"/.test(sql)) return [["author-1", "jane-austen", "Jane Austen"]];
  if (/from "books"/.test(sql)) return [["book-1", "test-book"]];
  if (/from "editions"/.test(sql)) return [editionRow];
  if (/from "chapters"/.test(sql)) return [chapterRow("c1", 1, "one"), chapterRow("c2", 2, "two")];
  if (/from "reading_progress"/.test(sql)) return /distinct/.test(sql) ? [["c2"]] : [["p1", "c2", 4, 40]];
  return [];
}

test("a dry run reads the state without any lock and asks only which chapters hold progress", async () => {
  const { tx, statements } = fakeTransaction(readResponder);

  const state = await loadState(tx, request, false);

  assert.equal(statements.length, 7);
  assert.ok(
    statements.every(({ sql }) => /^select /i.test(sql)),
    "only SELECT statements",
  );
  assert.ok(
    statements.every(({ sql }) => !/for update/i.test(sql)),
    "no locks in a read-only snapshot",
  );
  assert.match(statements.at(-1)!.sql, /select distinct "chapter_id" from "reading_progress"/i);
  assert.ok(!statements.some(({ sql }) => /"user_id"/.test(sql)), "no user identifiers are read");
  assert.deepEqual(state.progressChapterIds, ["c2"]);
  assert.deepEqual(state.progressRows, []);
  assert.equal(state.edition?.publicationStatus, "PUBLISHED");
  assert.deepEqual(
    state.chapters.map((chapter) => chapter.slug),
    ["one", "two"],
  );
  assert.deepEqual(state.bookAuthors, [{ id: "author-1", slug: "jane-austen", name: "Jane Austen" }]);
  // The stored blocks are read as they are (here a chapter imported before blocks), with the edition's images.
  assert.deepEqual(
    state.chapters.map((chapter) => chapter.blocks),
    [null, null],
  );
  const assets = statements.find(({ sql }) => /from "edition_assets"/.test(sql))!;
  assert.match(assets.sql, /inner join "image_assets"/);
  assert.ok(assets.params.includes("edition-1"));
  assert.deepEqual(state.assets, []);
});

test("a write reads the edition, its chapters and the saved positions FOR UPDATE", async () => {
  const { tx, statements } = fakeTransaction(readResponder);

  const state = await loadState(tx, request, true);

  const locked = statements.filter(({ sql }) => /for update/i.test(sql));
  assert.equal(locked.length, 3);
  // Assets may be shared with other editions: read, never locked.
  assert.ok(!locked.some(({ sql }) => /image_assets|edition_assets/.test(sql)));
  assert.ok(locked.some(({ sql }) => /from "editions"/.test(sql)));
  assert.ok(locked.some(({ sql }) => /from "chapters"/.test(sql)));
  assert.ok(locked.some(({ sql }) => /from "reading_progress"/.test(sql)));
  assert.ok(!statements.some(({ sql }) => /"user_id"/.test(sql)), "no user identifiers are read");
  assert.deepEqual(state.progressRows, [{ id: "p1", chapterId: "c2", paragraphIndex: 4, percentage: 40 }]);
  assert.deepEqual(state.progressChapterIds, ["c2"]);
});

function stateFixture(overrides: Partial<EditionState> = {}): EditionState {
  return {
    book: { id: "book-1", slug: "test-book" },
    bookAuthors: [],
    creatorAuthors: [],
    edition: null,
    chapters: [],
    assets: [],
    progressChapterIds: [],
    progressRows: [],
    ...overrides,
  };
}

const chapter = (number: number, slug: string, content = `${slug} text`) => ({
  number,
  slug,
  title: slug,
  content,
  wordCount: 3,
  blocks: { version: 1 as const, blocks: [{ type: "paragraph" as const, content: [{ text: content }] }] },
});

function input(chapters: ReturnType<typeof chapter>[], extra: Partial<PlanInput["incoming"]> = {}): PlanInput {
  return {
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
      chapters,
      images: [],
      ...extra,
    },
    warnings: [],
  };
}

const applyArgs = (state: EditionState, plan: PlanInput, coverUrl: string | null = null) => ({
  images: plan.incoming.images,
  verifiedKeys: new Set<string>(),
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
    coverUrl,
  },
});

test("a new edition is inserted as DRAFT / PENDING_REVIEW with its chapters; an existing author is never rewritten", async () => {
  const { tx, statements } = fakeTransaction((sql) => (/insert into "editions"/.test(sql) ? [["edition-new"]] : []));
  const state = stateFixture({
    creatorAuthors: [{ id: "author-9", slug: "jane-austen", name: "Jane Austen (hand-corrected)" }],
  });

  const result = await createOperations(tx).apply(
    applyArgs(state, input([chapter(1, "one"), chapter(2, "two")]), "https://covers.example/covers/new.jpg"),
  );

  assert.deepEqual(result, { bookId: "book-1", editionId: "edition-new", chapters: 2 });
  const sql = statements.map((statement) => statement.sql);
  assert.ok(!sql.some((text) => /update "authors"|insert into "authors"/.test(text)), "the existing author is reused");
  assert.ok(!sql.some((text) => /do update/.test(text)), "nothing is upserted with DO UPDATE");
  const edition = statements.find(({ sql: text }) => /insert into "editions"/.test(text))!;
  assert.ok(edition.params.includes("DRAFT") && edition.params.includes("PENDING_REVIEW"));
  assert.ok(edition.params.includes("https://covers.example/covers/new.jpg"));
  assert.equal(sql.filter((text) => /insert into "chapters"/.test(text)).length, 2);
  const link = statements.find(({ sql: text }) => /insert into "book_authors"/.test(text))!;
  assert.ok(link.params.includes("author-9"));
});

test("a new author is created with ON CONFLICT DO NOTHING and never overwrites a concurrent one", async () => {
  const { tx, statements } = fakeTransaction((sql) =>
    /insert into "authors"/.test(sql) ? [] : /insert into "editions"/.test(sql) ? [["edition-new"]] : [],
  );

  await assert.rejects(
    createOperations(tx).apply(applyArgs(stateFixture(), input([chapter(1, "one")]))),
    /Could not create or find author/,
  );

  const insert = statements.find(({ sql }) => /insert into "authors"/.test(sql))!;
  assert.match(insert.sql, /on conflict \("slug"\) do nothing/i);
  assert.ok(
    statements.some(({ sql }) => /from "authors"/.test(sql)),
    "falls back to reading the concurrent author",
  );
});

test("an existing edition is rewritten minimally: changed chapters only, vacate before delete before update before insert", async () => {
  const { tx, statements } = fakeTransaction();
  const existing = [chapter(1, "one"), chapter(2, "two", "old two"), chapter(3, "three"), chapter(4, "four")];
  const state = stateFixture({
    bookAuthors: [{ id: "author-1", slug: "jane-austen", name: "Jane Austen" }],
    edition: {
      id: "edition-1",
      bookId: "book-1",
      slug: "en-gutenberg-7",
      language: "en",
      title: "Test Book",
      translator: null,
      publicationYear: null,
      coverUrl: "https://covers.example/covers/test.jpg",
      sourceUrl: "https://www.gutenberg.org/ebooks/7",
      copyrightStatus: "PUBLIC_DOMAIN_VERIFIED",
      publicationStatus: "PUBLISHED",
    },
    chapters: existing.map((item, index) => ({ ...item, id: `c${index + 1}` })),
    progressRows: [{ id: "p1", chapterId: "c2", paragraphIndex: 1, percentage: 50 }],
    progressChapterIds: ["c2"],
  });
  // one unchanged; two rewritten (progress remapped); three renumbered; four removed; five new.
  const plan = input([chapter(1, "one"), chapter(2, "two", "new two"), chapter(4, "three"), chapter(5, "five")]);
  const args = applyArgs(state, plan);

  await createOperations(tx).apply(args);

  assert.deepEqual(
    args.diff.chapters.map((change) => change.kind),
    ["unchanged", "modified", "modified", "new"],
  );
  const kinds = statements.map(({ sql }) => sql.split(" ").slice(0, 3).join(" ").toLowerCase());
  const index = (needle: string) => kinds.findIndex((kind) => kind.startsWith(needle));
  const vacate = statements.findIndex(
    ({ sql, params }) => /update "chapters"/.test(sql) && params.some((p) => String(p).startsWith("__import_")),
  );
  const removal = index('delete from "chapters"');
  const insertion = index('insert into "chapters"');
  assert.ok(vacate >= 0 && vacate < removal && removal < insertion, "vacate, delete, then insert");

  const chapterWrites = statements.filter(({ sql }) => /update "chapters"/.test(sql));
  assert.ok(!chapterWrites.some(({ params }) => params.includes("c1")), "the unchanged chapter is never written");
  assert.ok(
    chapterWrites.some(({ params }) => params.includes("c2")),
    "the rewritten chapter is updated",
  );
  assert.ok(
    statements.some(({ sql, params }) => /update "reading_progress"/.test(sql) && params.includes("p1")),
    "its saved position is remapped",
  );
  const deletion = statements.find(({ sql }) => /delete from "chapters"/.test(sql))!;
  assert.ok(deletion.params.includes("c4") && !deletion.params.includes("c1"));
  assert.ok(
    !statements.some(({ sql }) => /update "editions"/.test(sql)),
    "no metadata changed, so the edition row is untouched",
  );
});

test("edition metadata updates never include the copyright or publication status", async () => {
  const { tx, statements } = fakeTransaction();
  const state = stateFixture({
    bookAuthors: [{ id: "author-1", slug: "jane-austen", name: "Jane Austen" }],
    edition: {
      id: "edition-1",
      bookId: "book-1",
      slug: "en-gutenberg-7",
      language: "en",
      title: "Old title",
      translator: null,
      publicationYear: null,
      coverUrl: null,
      sourceUrl: "https://www.gutenberg.org/ebooks/7",
      copyrightStatus: "PUBLIC_DOMAIN_VERIFIED",
      publicationStatus: "PUBLISHED",
    },
    chapters: [{ ...chapter(1, "one"), id: "c1" }],
  });

  await createOperations(tx).apply(applyArgs(state, input([chapter(1, "one")])));

  const update = statements.find(({ sql }) => /update "editions"/.test(sql))!;
  assert.match(update.sql, /"title" = \$/);
  for (const column of [
    "publication_status",
    "copyright_status",
    "verified_at",
    "copyright_notes",
    "is_preferred",
    "cover_url",
  ]) {
    assert.ok(!update.sql.includes(`"${column}"`), `${column} must not be written`);
  }
});

/** A postgres.js client double: records every statement and answers with no rows. Never connects. */
function fakePostgresClient() {
  const statements: string[] = [];
  const noRows = () => Object.assign(Promise.resolve([]), { values: () => Promise.resolve([]) });
  const client = {
    options: { parsers: {}, serializers: {} },
    unsafe(query: string) {
      statements.push(query);
      return noRows();
    },
    begin(callback: (transaction: unknown) => Promise<unknown>) {
      statements.push("begin");
      return callback(client);
    },
  };
  return { client: client as unknown as Sql, statements };
}

test("the write transaction is READ COMMITTED, set before the advisory lock; the read stays REPEATABLE READ", async () => {
  assert.deepEqual(WRITE_TRANSACTION, { isolationLevel: "read committed" });
  const { client, statements } = fakePostgresClient();
  const database = createImportDatabase(
    postgresJsDrizzle(client),
    describeDatabaseTarget("postgres://libra:not-a-password@127.0.0.1:5432/libra"),
    async () => {},
  );

  await database.write(request, async () => "done");
  assert.equal(statements[0], "begin");
  assert.equal(statements[1], "set transaction isolation level read committed");
  assert.match(statements[2], /pg_advisory_xact_lock/);

  statements.length = 0;
  await database.readState(request);
  assert.equal(statements[1], "set transaction isolation level repeatable read read only");
});
