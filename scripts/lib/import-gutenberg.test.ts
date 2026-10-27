import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import JSZip from "jszip";

import type { ApplyArgs, ImportDatabase } from "./import-database";
import { importGutenbergBook, type ImportGutenbergOptions } from "./import-gutenberg";
import { describeDatabaseTarget } from "./import-plan";
import { ImportBlockedError, type EditionState } from "./import-state";
import { removeRealStorageSettings, testImportDependencies } from "./import-test-guards";
import { parseEpub } from "./parse-epub";
import { createSharpCodec } from "./sharp-codec";

// Everything here runs against an in-memory database double: no PostgreSQL, R2 or network.
removeRealStorageSettings();

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const sentence = (title: string, words = 60) => `Texto de ${title}. `.repeat(Math.ceil(words / 3)).trim();

interface FixtureChapter {
  title: string;
  words?: number;
  body?: string;
}

async function writeEpub(
  t: TestContext,
  chapters: FixtureChapter[],
  { creator = "Austen, Jane", cover = true, name = "book.epub" } = {},
) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "libra-import-"));
  t.after(async () => {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    await fs.rm(target, { recursive: true, force: true });
  });

  const zip = new JSZip();
  zip.file("META-INF/container.xml", '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>');
  zip.file(
    "book.opf",
    `<package xmlns:dc="http://purl.org/dc/elements/1.1/">
      <metadata><dc:title>Test Book</dc:title>${creator ? `<dc:creator>${creator}</dc:creator>` : ""}<dc:language>en</dc:language></metadata>
      <manifest>
        <item id="text" href="text.xhtml" media-type="application/xhtml+xml"/>
        ${cover ? '<item id="cover" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>' : ""}
      </manifest>
      <spine><itemref idref="text"/></spine>
    </package>`,
  );
  zip.file(
    "text.xhtml",
    `<html xmlns="http://www.w3.org/1999/xhtml"><body>${chapters
      .map((chapter) => `<h2>${chapter.title}</h2><p>${chapter.body ?? sentence(chapter.title, chapter.words)}</p>`)
      .join("")}</body></html>`,
  );
  if (cover) zip.file("cover.jpg", jpeg);

  const file = path.join(directory, name);
  await fs.writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));

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

/** The database state that results from having imported `file` earlier. */
async function stateAfterImporting(
  file: string,
  publicationStatus: "DRAFT" | "PUBLISHED",
  overrides: Partial<EditionState> = {},
): Promise<EditionState> {
  const parsed = await parseEpub(await fs.readFile(file));

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
      coverUrl: "https://covers.example/covers/test-book-7-stale.jpg",
      sourceUrl: "https://www.gutenberg.org/ebooks/7",
      copyrightStatus: publicationStatus === "PUBLISHED" ? "PUBLIC_DOMAIN_VERIFIED" : "PENDING_REVIEW",
      publicationStatus,
    },
    chapters: parsed.chapters.map((chapter) => ({ ...chapter, id: `chapter-${chapter.slug}` })),
    assets: [],
    progressChapterIds: [],
    progressRows: [],
    ...overrides,
  };
}

function fakeDatabase(initial: EditionState, { failRead = false } = {}) {
  let state = initial;
  const committed: ApplyArgs[] = [];
  const database: ImportDatabase = {
    // Fictitious on purpose: reserved .invalid host and an obviously fake password, assembled from parts.
    target: describeDatabaseTarget(
      [
        "postgres://postgres.exampleprojectref",
        ":not-a-real-password",
        "@db-pool-1.example.invalid:5432/postgres",
      ].join(""),
    ),
    async readState() {
      if (failRead) throw Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), { code: "ECONNREFUSED" });
      return state;
    },
    async write(_request, run) {
      const staged: ApplyArgs[] = [];
      const result = await run(state, {
        async apply(args) {
          staged.push(args);
          return {
            bookId: "book-1",
            editionId: state.edition?.id ?? "edition-new",
            chapters: args.diff.chapters.length,
          };
        },
      });
      // Only reached when `run` did not throw: a throw is a rollback and nothing is committed.
      committed.push(...staged);
      return result;
    },
    async close() {},
  };

  return {
    database,
    committed,
    setState(next: EditionState) {
      state = next;
    },
  };
}

function quiet(t: TestContext) {
  const printed: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => printed.push(args.map(String).join(" ")));
  t.mock.method(console, "warn", (...args: unknown[]) => printed.push(args.map(String).join(" ")));
  return printed;
}

function options(file: string, extra: Partial<ImportGutenbergOptions> = {}): ImportGutenbergOptions {
  return { file, gutenbergId: "7", slug: "test-book", originalTitle: "Test Book", originalLanguage: "en", ...extra };
}

function dependencies(database: ImportDatabase) {
  const uploads: string[] = [];
  const revalidations: string[][] = [];

  return {
    uploads,
    revalidations,
    dependencies: testImportDependencies({
      database,
      // The real sharp codec, unverified: these tests run on any platform, not only the approved one.
      createCodec: async () => createSharpCodec(),
      uploadCover: async (input: { bookSlug: string }) => {
        uploads.push(input.bookSlug);
        return "https://covers.example/covers/uploaded.jpg";
      },
      revalidate: async (tags: string[]) => {
        revalidations.push(tags);
        return true;
      },
    }),
  };
}

const threeChapters: FixtureChapter[] = [{ title: "One" }, { title: "Two" }, { title: "Three" }];

test("a dry run of a new edition compares with the database, plans everything as new and writes nothing", async (t) => {
  const printed = quiet(t);
  const file = await writeEpub(t, threeChapters);
  const { database, committed } = fakeDatabase(emptyState);
  const { dependencies: deps, uploads } = dependencies(database);

  const outcome = await importGutenbergBook(options(file), deps);

  assert.equal(outcome.status, "planned");
  assert.ok("diff" in outcome && outcome.diff.totals.new === 3 && !outcome.diff.edition.exists);
  assert.deepEqual(committed, []);
  assert.deepEqual(uploads, []);
  assert(printed.some((line) => line.includes("Plan against the current database")));
  assert(printed.some((line) => line.includes("Target database:") && line.includes("role postgres")));
  assert(printed.some((line) => line.includes("Dry run only")));
  assert(
    !printed.some(
      (line) => line.includes("exampleprojectref") || line.includes("not-a-real") || line.includes("db-pool-1"),
    ),
  );
});

test("L02: a database that cannot be read fails the dry run instead of reporting a plan with no removals", async (t) => {
  const printed = quiet(t);
  const file = await writeEpub(t, threeChapters);
  const { database } = fakeDatabase(emptyState, { failRead: true });
  const { dependencies: deps } = dependencies(database);

  await assert.rejects(importGutenbergBook(options(file), deps), (error: Error) => {
    assert.match(error.message, /Could not read the current database state/);
    assert.match(error.message, /ECONNREFUSED/);
    assert.match(error.message, /no plan is reported/);
    return true;
  });
  assert(!printed.some((line) => /to remove|Nothing to write|Plan against/.test(line)));
});

test("L02: the dry run lists chapters that would disappear and blocks them until removals are allowed", async (t) => {
  const printed = quiet(t);
  const original = await writeEpub(t, threeChapters);
  const shrunk = await writeEpub(t, [{ title: "One" }, { title: "Two" }]);
  const { database } = fakeDatabase(await stateAfterImporting(original, "DRAFT"));
  const { dependencies: deps } = dependencies(database);

  const blocked = await importGutenbergBook(options(shrunk), deps);

  assert.equal(blocked.status, "blocked");
  assert.ok("diff" in blocked && blocked.diff.removed.map((chapter) => chapter.slug).join() === "three");
  assert.ok("violations" in blocked && blocked.violations.some((violation) => violation.includes("--allow-removals")));
  assert(printed.some((line) => line.includes("Chapters that would disappear") || line.includes("- #3 three")));

  const allowed = await importGutenbergBook(options(shrunk, { allowRemovals: true }), deps);

  assert.equal(allowed.status, "planned");
});

test("L02: chapters with saved reading progress are never removed, even with every removal flag", async (t) => {
  quiet(t);
  const original = await writeEpub(t, threeChapters);
  const shrunk = await writeEpub(t, [{ title: "One" }, { title: "Two" }]);
  const state = await stateAfterImporting(original, "DRAFT", { progressChapterIds: ["chapter-three"] });
  const { database, committed } = fakeDatabase(state);
  const { dependencies: deps, uploads } = dependencies(database);
  const target = database.target.token;

  const dryRun = await importGutenbergBook(options(shrunk, { allowRemovals: true, acceptWarnings: true }), deps);
  assert.equal(dryRun.status, "blocked");
  assert.ok("violations" in dryRun && dryRun.violations.some((violation) => violation.includes("reading progress")));

  await assert.rejects(
    importGutenbergBook(
      options(shrunk, { apply: true, confirmDatabase: target, allowRemovals: true, acceptWarnings: true }),
      deps,
    ),
    ImportBlockedError,
  );
  assert.deepEqual(committed, []);
  assert.deepEqual(uploads, []);
});

test("L02: a normal import never modifies a published edition", async (t) => {
  quiet(t);
  const original = await writeEpub(t, threeChapters);
  const edited = await writeEpub(t, [
    { title: "One" },
    { title: "Two", body: "A rewritten second chapter." },
    { title: "Three" },
  ]);
  const { database, committed } = fakeDatabase(await stateAfterImporting(original, "PUBLISHED"));
  const { dependencies: deps, uploads, revalidations } = dependencies(database);

  const dryRun = await importGutenbergBook(options(edited), deps);
  assert.equal(dryRun.status, "blocked");
  assert.ok(
    "violations" in dryRun &&
      dryRun.violations.some((violation) => /PUBLISHED.*--revise-published --plan-hash/.test(violation)),
  );

  // The old escape hatch is not enough.
  await assert.rejects(
    importGutenbergBook(
      options(edited, {
        apply: true,
        confirmDatabase: database.target.token,
        allowRemovals: true,
        allowSlugChanges: true,
        acceptWarnings: true,
      }),
      deps,
    ),
    (error: unknown) =>
      error instanceof ImportBlockedError && error.violations.some((violation) => violation.includes("PUBLISHED")),
  );
  assert.deepEqual(committed, []);
  assert.deepEqual(uploads, []);
  assert.deepEqual(revalidations, []);
});

test("an unchanged published edition is left alone: no writes, no cover upload, no cache invalidation", async (t) => {
  quiet(t);
  const file = await writeEpub(t, threeChapters);
  const state = await stateAfterImporting(file, "PUBLISHED");
  const parsed = await parseEpub(await fs.readFile(file));
  // Store exactly the cover key the EPUB would produce, so nothing differs.
  const { coverKeyFor } = await import("./r2");
  state.edition!.coverUrl = `https://covers.example/${coverKeyFor({ bookSlug: "test-book", gutenbergId: "7", data: parsed.cover!.data, extension: parsed.cover!.extension })}`;
  const { database, committed } = fakeDatabase(state);
  const { dependencies: deps, uploads, revalidations } = dependencies(database);

  const dryRun = await importGutenbergBook(options(file), deps);
  assert.equal(dryRun.status, "unchanged");

  const applied = await importGutenbergBook(
    options(file, { apply: true, confirmDatabase: database.target.token }),
    deps,
  );
  assert.equal(applied.status, "unchanged");
  assert.deepEqual(committed, []);
  assert.deepEqual(uploads, []);
  assert.deepEqual(revalidations, []);
});

test("L02: revising a published edition needs the digest of the reviewed plan, rechecked under lock", async (t) => {
  quiet(t);
  const original = await writeEpub(t, threeChapters);
  const edited = await writeEpub(t, [
    { title: "One" },
    { title: "Two", body: "A rewritten second chapter." },
    { title: "Three" },
  ]);
  const fake = fakeDatabase(await stateAfterImporting(original, "PUBLISHED"));
  const { dependencies: deps, revalidations } = dependencies(fake.database);
  const confirmDatabase = fake.database.target.token;

  const review = await importGutenbergBook(options(edited, { revisePublished: true }), deps);
  assert.ok("planDigest" in review);
  const digest = review.planDigest;
  assert.match(digest, /^[0-9a-f]{20}$/);

  // Missing and wrong digests are refused.
  for (const planHash of [undefined, "0".repeat(20)]) {
    await assert.rejects(
      importGutenbergBook(options(edited, { apply: true, confirmDatabase, revisePublished: true, planHash }), deps),
      ImportBlockedError,
    );
  }
  assert.deepEqual(fake.committed, []);

  // The database changes after the review (someone edited chapter three): the reviewed digest no longer applies.
  const drifted = await stateAfterImporting(original, "PUBLISHED");
  drifted.chapters = drifted.chapters.map((chapter) =>
    chapter.slug === "three" ? { ...chapter, content: `${chapter.content} extra` } : chapter,
  );
  fake.setState(drifted);
  await assert.rejects(
    importGutenbergBook(
      options(edited, { apply: true, confirmDatabase, revisePublished: true, planHash: digest }),
      deps,
    ),
    (error: unknown) =>
      error instanceof ImportBlockedError && error.violations.some((violation) => violation.includes("does not match")),
  );
  assert.deepEqual(fake.committed, []);

  // Reviewing the real state again produces a new digest that is accepted.
  const fresh = await importGutenbergBook(options(edited, { revisePublished: true }), deps);
  assert.ok("planDigest" in fresh && fresh.planDigest !== digest);
  const applied = await importGutenbergBook(
    options(edited, { apply: true, confirmDatabase, revisePublished: true, planHash: fresh.planDigest }),
    deps,
  );
  assert.equal(applied.status, "applied");
  const committed: ApplyArgs[] = fake.committed;
  assert.equal(committed.length, 1);
  // Chapter three still carries the drifted text in the database, so the EPUB's version replaces it.
  assert.deepEqual(
    committed[0].diff.chapters.map((change) => change.kind),
    ["unchanged", "modified", "modified"],
  );
  assert.deepEqual(revalidations, [["book:test-book", "library"]]);
});

test("changing the URL of a published chapter needs its own explicit flag even with a reviewed plan", async (t) => {
  quiet(t);
  const original = await writeEpub(t, threeChapters);
  const renamed = await writeEpub(t, [
    { title: "One" },
    { title: "Two", body: sentence("Two") },
    { title: "Third", body: sentence("Three") },
  ]);
  const state = await stateAfterImporting(original, "PUBLISHED");
  const { database } = fakeDatabase(state);
  const { dependencies: deps } = dependencies(database);

  const review = await importGutenbergBook(options(renamed, { revisePublished: true }), deps);
  assert.ok("planDigest" in review);
  const withHash = options(renamed, { revisePublished: true, planHash: review.planDigest });

  const refused = await importGutenbergBook(withHash, deps);
  assert.equal(refused.status, "blocked");
  assert.ok(
    "violations" in refused && refused.violations.some((violation) => violation.includes("--allow-slug-changes")),
  );
  assert.equal(
    (await importGutenbergBook({ ...withHash, allowSlugChanges: true, allowRemovals: false }, deps)).status,
    "planned",
  );
});

test("writing requires the target database id printed by the dry run", async (t) => {
  quiet(t);
  const file = await writeEpub(t, threeChapters);
  const { database, committed } = fakeDatabase(emptyState);
  const { dependencies: deps, uploads } = dependencies(database);

  await assert.rejects(importGutenbergBook(options(file, { apply: true }), deps), /requires --confirm-database \S+/);
  await assert.rejects(
    importGutenbergBook(options(file, { apply: true, confirmDatabase: "wrong..id" }), deps),
    /does not match/,
  );
  assert.deepEqual(committed, []);
  assert.deepEqual(uploads, []);
});

test("applying a new edition uploads the cover once, after the checks, and invalidates the cache", async (t) => {
  quiet(t);
  const file = await writeEpub(t, threeChapters);
  const { database, committed } = fakeDatabase(emptyState);
  const { dependencies: deps, uploads, revalidations } = dependencies(database);

  const outcome = await importGutenbergBook(
    options(file, { apply: true, confirmDatabase: database.target.token }),
    deps,
  );

  assert.equal(outcome.status, "applied");
  assert.deepEqual(uploads, ["test-book"]);
  assert.equal(committed.length, 1);
  assert.equal(committed[0].edition.coverUrl, "https://covers.example/covers/uploaded.jpg");
  assert.equal(committed[0].diff.totals.new, 3);
  assert.deepEqual(revalidations, [["book:test-book", "library"]]);
});

test("a slug derived from the title cannot silently attach the source to an existing book", async (t) => {
  quiet(t);
  const file = await writeEpub(t, threeChapters);
  const state = { ...emptyState, book: { id: "book-1", slug: "test-book" } };
  const { database } = fakeDatabase(state);
  const { dependencies: deps } = dependencies(database);

  const derived = await importGutenbergBook({ ...options(file), slug: undefined }, deps);
  assert.equal(derived.status, "blocked");
  assert.ok(
    "violations" in derived && derived.violations.some((violation) => violation.includes("pass --slug explicitly")),
  );

  const explicit = await importGutenbergBook(options(file), deps);
  assert.equal(explicit.status, "planned");
  assert.ok("diff" in explicit && explicit.diff.attachesToExistingBook);
});

test("L04: an existing author is reused as stored, never renamed or merged by the import", async (t) => {
  const printed = quiet(t);
  const file = await writeEpub(t, threeChapters, { creator: "Austen, Jane" });
  const state: EditionState = {
    ...emptyState,
    creatorAuthors: [{ id: "author-9", slug: "jane-austen", name: "Jane Austen (hand-corrected)" }],
  };
  const { database, committed } = fakeDatabase(state);
  const { dependencies: deps } = dependencies(database);

  const outcome = await importGutenbergBook(
    options(file, { apply: true, confirmDatabase: database.target.token }),
    deps,
  );

  assert.equal(outcome.status, "applied");
  assert.deepEqual(committed[0].diff.authors, [
    { slug: "jane-austen", name: "Jane Austen", action: "reuse", existingName: "Jane Austen (hand-corrected)" },
  ]);
  assert(printed.some((line) => line.includes("the stored name is kept")));
});

test("a book whose EPUB names no creator is refused because the catalog would never list it", async (t) => {
  quiet(t);
  const file = await writeEpub(t, threeChapters, { creator: "" });
  const { database } = fakeDatabase(emptyState);
  const { dependencies: deps } = dependencies(database);

  const outcome = await importGutenbergBook(options(file), deps);

  assert.equal(outcome.status, "blocked");
  assert.ok("violations" in outcome && outcome.violations.some((violation) => violation.includes("no creator")));
});

test("extraction warnings block the write until they are accepted", async (t) => {
  quiet(t);
  const file = await writeEpub(t, [
    { title: "Preface", body: sentence("prefacio", 1700) },
    { title: "One", words: 3000 },
    { title: "Two", words: 3000 },
  ]);
  const { database, committed } = fakeDatabase(emptyState);
  const { dependencies: deps } = dependencies(database);
  const confirmDatabase = database.target.token;

  const dryRun = await importGutenbergBook(options(file), deps);
  assert.equal(dryRun.status, "blocked");
  assert.ok("violations" in dryRun && dryRun.violations.some((violation) => violation.includes("--accept-warnings")));

  await assert.rejects(importGutenbergBook(options(file, { apply: true, confirmDatabase }), deps), ImportBlockedError);
  assert.deepEqual(committed, []);

  const accepted = await importGutenbergBook(
    options(file, { apply: true, confirmDatabase, acceptWarnings: true }),
    deps,
  );
  assert.equal(accepted.status, "applied");
});

test("--epub-only can never be combined with --apply", async (t) => {
  quiet(t);
  const file = await writeEpub(t, threeChapters);

  await assert.rejects(importGutenbergBook(options(file, { apply: true, epubOnly: true })), /can never be combined/);
});

test("importer arguments are validated before the EPUB is even read", async () => {
  const base = { file: "does-not-exist.epub", originalTitle: "T", originalLanguage: "en" };

  await assert.rejects(importGutenbergBook({ ...base, gutenbergId: "abc" }), /Invalid Gutenberg ID/);
  await assert.rejects(importGutenbergBook({ ...base, gutenbergId: "7", slug: "Bad Slug" }), /Invalid slug/);
  await assert.rejects(
    importGutenbergBook({ ...base, gutenbergId: "7", originalLanguage: "english!" }),
    /Invalid original language/,
  );
  await assert.rejects(importGutenbergBook({ ...base, gutenbergId: "7", originalTitle: "  " }), /original title/);
});

test("REVIEW: --epub-only never opens, queries or writes the database, even when one is injected or configured", async (t) => {
  quiet(t);
  const file = await writeEpub(t, threeChapters);
  const touched: string[] = [];
  const trap = new Proxy({} as ImportDatabase, {
    get(_target, property) {
      touched.push(String(property));
      throw new Error(`the database was touched through ${String(property)}`);
    },
  });
  // If the importer tried to open its own connection it would fail on this value before any network use.
  const previousUrl = process.env.DIRECT_DATABASE_URL;
  process.env.DIRECT_DATABASE_URL = "not a url";
  t.after(() => {
    if (previousUrl === undefined) delete process.env.DIRECT_DATABASE_URL;
    else process.env.DIRECT_DATABASE_URL = previousUrl;
  });
  const { dependencies: deps, uploads, revalidations } = dependencies(trap);

  const outcome = await importGutenbergBook(options(file, { epubOnly: true }), deps);

  assert.deepEqual(outcome, { status: "epub-only" });
  assert.deepEqual(touched, []);
  assert.deepEqual(uploads, []);
  assert.deepEqual(revalidations, []);
});

test("REVIEW: an error in the middle of the write commits nothing and invalidates no cache", async (t) => {
  quiet(t);
  const file = await writeEpub(t, threeChapters);
  const fake = fakeDatabase(emptyState);
  const failing: ImportDatabase = {
    ...fake.database,
    write: (request, run) =>
      fake.database.write(request, (state, operations) =>
        run(state, {
          async apply(args) {
            await operations.apply(args);
            throw new Error("connection lost after the chapters were staged");
          },
        }),
      ),
  };
  const { dependencies: deps, revalidations } = dependencies(failing);

  await assert.rejects(
    importGutenbergBook(options(file, { apply: true, confirmDatabase: failing.target.token }), deps),
    /connection lost/,
  );

  assert.deepEqual(fake.committed, [], "staged writes are discarded with the transaction");
  assert.deepEqual(revalidations, [], "no cache is invalidated for a write that did not commit");
});

test("REVIEW: a failing cover upload aborts the transaction before any row is written", async (t) => {
  quiet(t);
  const file = await writeEpub(t, threeChapters);
  const fake = fakeDatabase(emptyState);
  const { dependencies: deps, revalidations } = dependencies(fake.database);

  await assert.rejects(
    importGutenbergBook(options(file, { apply: true, confirmDatabase: fake.database.target.token }), {
      ...deps,
      uploadCover: async () => {
        throw new Error("R2 unavailable");
      },
    }),
    /R2 unavailable/,
  );

  assert.deepEqual(fake.committed, []);
  assert.deepEqual(revalidations, []);
});

test("REVIEW: a plan hash reviewed for one EPUB does not authorize a different EPUB for the same edition", async (t) => {
  quiet(t);
  const original = await writeEpub(t, threeChapters);
  const reviewed = await writeEpub(t, [
    { title: "One" },
    { title: "Two", body: "The second chapter, as reviewed." },
    { title: "Three" },
  ]);
  const swapped = await writeEpub(t, [
    { title: "One" },
    { title: "Two", body: "A different second chapter that nobody reviewed." },
    { title: "Three" },
  ]);
  const fake = fakeDatabase(await stateAfterImporting(original, "PUBLISHED"));
  const { dependencies: deps } = dependencies(fake.database);
  const confirmDatabase = fake.database.target.token;

  const review = await importGutenbergBook(options(reviewed, { revisePublished: true }), deps);
  assert.ok("planDigest" in review);

  await assert.rejects(
    importGutenbergBook(
      options(swapped, { apply: true, confirmDatabase, revisePublished: true, planHash: review.planDigest }),
      deps,
    ),
    (error: unknown) =>
      error instanceof ImportBlockedError && error.violations.some((violation) => violation.includes("does not match")),
  );
  assert.deepEqual(fake.committed, []);
});

test("REVIEW: --plan-hash without --revise-published, and --revise-published on a draft, authorize nothing extra", async (t) => {
  quiet(t);
  const original = await writeEpub(t, threeChapters);
  const edited = await writeEpub(t, [{ title: "One" }, { title: "Two", body: "Rewritten." }, { title: "Three" }]);
  const fake = fakeDatabase(await stateAfterImporting(original, "PUBLISHED"));
  const { dependencies: deps } = dependencies(fake.database);

  // A published edition changed by a plan: no flag combination other than reviewed hash + --revise-published passes.
  const blocked = await importGutenbergBook(options(edited, { planHash: "0".repeat(20) }), deps);
  assert.equal(blocked.status, "blocked");
  assert.ok("violations" in blocked && blocked.violations.some((violation) => violation.includes("PUBLISHED")));

  const withEveryOtherFlag = await importGutenbergBook(
    options(edited, { allowRemovals: true, allowSlugChanges: true, acceptWarnings: true }),
    deps,
  );
  assert.equal(
    withEveryOtherFlag.status,
    "blocked",
    "the removal, slug and warning gates do not open published editions",
  );
});
