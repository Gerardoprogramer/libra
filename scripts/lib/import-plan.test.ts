import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildImportDiff,
  computePlanDigest,
  defaultImportFlags,
  describeDatabaseTarget,
  evaluateImportPolicy,
  formatImportDiff,
  type PlanInput,
} from "./import-plan";
import type { EditionState } from "./import-state";

/** One paragraph block per paragraph of the text: blocks that derive exactly `content`. */
const blocksFor = (content: string) => ({
  version: 1 as const,
  blocks: content.split("\n\n").map((text) => ({ type: "paragraph" as const, content: [{ text }] })),
});

const chapter = (number: number, slug: string, content = `${slug} text`, title = slug) => ({
  number,
  slug,
  title,
  content,
  wordCount: content.split(/\s+/).length,
  blocks: blocksFor(content),
});

/** Stored as an earlier import with blocks wrote them. */
const stored = (items: ReturnType<typeof chapter>[]): EditionState["chapters"] =>
  items.map((item) => ({ ...item, id: `id-${item.slug}` }));

function state(overrides: Partial<EditionState> = {}): EditionState {
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
    chapters: stored([chapter(1, "one"), chapter(2, "two"), chapter(3, "three")]),
    assets: [],
    progressChapterIds: [],
    progressRows: [],
    ...overrides,
  };
}

function input(chapters: ReturnType<typeof chapter>[], extra: Partial<PlanInput> = {}): PlanInput {
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
      chapters,
      images: [],
    },
    warnings: [],
    ...extra,
  };
}

const same = [chapter(1, "one"), chapter(2, "two", "two rewritten"), chapter(3, "three")];

function digestOf(current: EditionState, plan: PlanInput, acceptWarnings = false) {
  return computePlanDigest(current, plan, buildImportDiff(current, plan), { acceptWarnings });
}

test("REVIEW: the plan digest changes with the EPUB bytes, any stored chapter, the progress set and the metadata", () => {
  const base = digestOf(state(), input(same));

  assert.equal(digestOf(state(), input(same)), base, "deterministic for the same state and EPUB");

  const differentEpub = digestOf(state(), input(same, { epubSha256: "b".repeat(64) }));
  const editedStoredChapter = digestOf(
    state({ chapters: stored([chapter(1, "one"), chapter(2, "two"), chapter(3, "three", "three edited by hand")]) }),
    input(same),
  );
  const renamedStoredChapter = digestOf(
    state({ chapters: stored([chapter(1, "one"), chapter(2, "two", undefined, "Two!"), chapter(3, "three")]) }),
    input(same),
  );
  const newProgress = digestOf(state({ progressChapterIds: ["id-two"] }), input(same));
  const otherStatus = digestOf(state({ edition: { ...state().edition!, publicationStatus: "DRAFT" } }), input(same));
  const otherEdition = digestOf(state({ edition: { ...state().edition!, id: "edition-2" } }), input(same));
  const metadataDrift = digestOf(state({ edition: { ...state().edition!, translator: "Someone" } }), input(same));

  const all = [
    base,
    differentEpub,
    editedStoredChapter,
    renamedStoredChapter,
    newProgress,
    otherStatus,
    otherEdition,
    metadataDrift,
  ];
  assert.equal(new Set(all).size, all.length, "every difference yields a different digest");
});

test("REVIEW: a digest reviewed for one plan is refused for any other plan on a published edition", () => {
  const current = state();
  const reviewedPlan = input(same);
  const reviewed = digestOf(current, reviewedPlan);
  const flags = { ...defaultImportFlags, revisePublished: true, planHash: reviewed };

  const decide = (plan: PlanInput, against = current) => {
    const diff = buildImportDiff(against, plan);
    return evaluateImportPolicy({
      diff,
      digest: computePlanDigest(against, plan, diff, flags),
      extractionWarnings: [],
      slugWasExplicit: true,
      flags,
    });
  };

  assert.deepEqual(decide(reviewedPlan), [], "the plan that was reviewed is accepted");
  assert.match(
    decide(input([chapter(1, "one"), chapter(2, "two", "something else"), chapter(3, "three")])).join(),
    /does not match/,
  );
  assert.match(decide(input(same, { epubSha256: "c".repeat(64) })).join(), /does not match/);
  assert.match(
    decide(
      reviewedPlan,
      state({ chapters: stored([chapter(1, "one"), chapter(2, "two"), chapter(3, "three", "x")]) }),
    ).join(),
    /does not match/,
  );
});

test("REVIEW: removed chapters and slug changes are listed explicitly, and progress is flagged", () => {
  const current = state({ progressChapterIds: ["id-three"] });
  const plan = input([chapter(1, "one"), chapter(2, "two-renamed", "two text", "two")]);
  const diff = buildImportDiff(current, plan);
  const text = formatImportDiff(diff).join("\n");

  assert.match(text, /Chapters that would disappear/);
  assert.match(text, /- #3 three .*HAS READING PROGRESS/);
  assert.match(text, /slug two -> two-renamed/);
  assert.equal(diff.totals.removedWithProgress, 1);

  const violations = evaluateImportPolicy({
    diff,
    digest: computePlanDigest(current, plan, diff, defaultImportFlags),
    extractionWarnings: [],
    slugWasExplicit: true,
    flags: { ...defaultImportFlags, allowRemovals: true, allowSlugChanges: true },
  });
  assert.ok(
    violations.some((violation) => /saved reading progress/.test(violation)),
    "no flag removes chapters with progress",
  );
});

test("REVIEW: a draft edition still refuses removals and chapters with progress without their own flags", () => {
  const draft = state({ edition: { ...state().edition!, publicationStatus: "DRAFT" } });
  const plan = input([chapter(1, "one"), chapter(2, "two")]);
  const diff = buildImportDiff(draft, plan);
  const policy = (flags = defaultImportFlags) =>
    evaluateImportPolicy({ diff, digest: "d", extractionWarnings: [], slugWasExplicit: true, flags });

  assert.match(policy().join(), /--allow-removals/);
  assert.deepEqual(policy({ ...defaultImportFlags, allowRemovals: true }), []);
});

test("REVIEW: database targets are described without the password, the user's project or the whole host", () => {
  // Fictitious on purpose: a host under the reserved .invalid TLD and an obviously fake password, assembled from
  // parts so that no complete connection string sits in the source. "%2F" keeps the percent-decoding covered.
  const url = [
    "postgresql://postgres.exampleprojectref",
    ":not-a-real%2Fpassword",
    "@db-pool-1.example.invalid:6543/postgres?sslmode=require",
  ].join("");
  const target = describeDatabaseTarget(url);
  const printed = JSON.stringify(target);

  for (const secret of ["not-a-real", "exampleprojectref", "db-pool-1", "sslmode"]) {
    assert.ok(!printed.includes(secret), `${secret} must not appear in ${printed}`);
  }
  assert.equal(target.isLocal, false);
  // Localhost lookalikes are not local.
  for (const host of ["localhost.evil.test", "127.0.0.1.evil.test", "evil.test"]) {
    assert.equal(describeDatabaseTarget(`postgres://u:p@${host}:5432/db`).isLocal, false, host);
  }
  assert.throws(
    () => describeDatabaseTarget("postgres://u:topsecret@[bad"),
    (error: unknown) => {
      assert.ok(!String((error as Error).message).includes("topsecret"));
      return true;
    },
  );
});
