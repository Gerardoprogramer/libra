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
import { isCustomCoverUrl } from "./custom-cover";
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

const unchangedChapters = [chapter(1, "one"), chapter(2, "two"), chapter(3, "three")];
const customUrl = "https://covers.example/covers/libra/test-book-7-0123456789ab.jpg";
const epubCoverKey = "covers/test-book-7-fedcba987654.jpg";
const withCover = (coverUrl: string | null, publicationStatus: "DRAFT" | "PUBLISHED" = "DRAFT") =>
  state({ edition: { ...state().edition!, coverUrl, publicationStatus } });
const withEpubCover = (extra: Partial<PlanInput> = {}) => {
  const plan = input(unchangedChapters, extra);
  return { ...plan, incoming: { ...plan.incoming, coverKey: epubCoverKey } };
};

test("COVER: a re-import keeps a custom cover, says so, and leaves the plan unchanged when nothing else differs", () => {
  for (const status of ["DRAFT", "PUBLISHED"] as const) {
    const current = withCover(customUrl, status);
    const diff = buildImportDiff(current, withEpubCover());

    assert.deepEqual(diff.customCover, { url: customUrl, action: "kept" });
    assert.deepEqual(diff.metadata, []);
    assert.equal(diff.hasChanges, false, status);
    assert(formatImportDiff(diff).some((line) => line.includes("custom cover kept") && line.includes(customUrl)));
    // A published edition needs no --revise-published for a plan that writes nothing.
    assert.deepEqual(
      evaluateImportPolicy({
        diff,
        digest: digestOf(current, withEpubCover()),
        extractionWarnings: [],
        slugWasExplicit: true,
        flags: defaultImportFlags,
      }),
      [],
    );
  }
});

test("COVER: a custom cover is kept with other changes too, and only those changes are planned", () => {
  const diff = buildImportDiff(withCover(customUrl), {
    ...withEpubCover(),
    incoming: { ...withEpubCover().incoming, chapters: same },
  });

  assert.equal(diff.customCover?.action, "kept");
  assert.equal(diff.metadata.length, 0);
  assert.equal(diff.totals.modified, 1);
  assert.equal(diff.hasChanges, true);
});

test("COVER: Gutenberg covers keep the normal behavior: a different one, a missing one and a new edition", () => {
  const different = buildImportDiff(
    withCover("https://covers.example/covers/test-book-7-000000000000.jpg"),
    withEpubCover(),
  );
  assert.deepEqual(different.metadata, [
    { field: "cover", from: "https://covers.example/covers/test-book-7-000000000000.jpg", to: epubCoverKey },
  ]);
  assert.equal(different.customCover, null);

  const missing = buildImportDiff(withCover(null), withEpubCover());
  assert.deepEqual(missing.metadata, [{ field: "cover", from: null, to: epubCoverKey }]);
  assert.equal(missing.customCover, null);

  const same = buildImportDiff(withCover(`https://covers.example/${epubCoverKey}`), withEpubCover());
  assert.equal(same.hasChanges, false);
  assert.equal(same.customCover, null);

  const created = buildImportDiff(state({ edition: null, chapters: [] }), withEpubCover());
  assert.equal(created.edition.exists, false);
  assert.equal(created.customCover, null);
  assert.equal(created.hasChanges, true);
});

test("COVER: --replace-custom-cover plans the EPUB's cover, and does nothing when the EPUB has none", () => {
  const replaced = buildImportDiff(withCover(customUrl), withEpubCover({ replaceCustomCover: true }));
  assert.deepEqual(replaced.customCover, { url: customUrl, action: "replaced" });
  assert.deepEqual(replaced.metadata, [{ field: "cover", from: customUrl, to: epubCoverKey }]);
  assert.equal(replaced.hasChanges, true);
  assert(formatImportDiff(replaced).some((line) => line.includes("will be replaced by the EPUB's")));

  const noEpubCover = buildImportDiff(withCover(customUrl), input(unchangedChapters, { replaceCustomCover: true }));
  assert.equal(noEpubCover.customCover?.action, "kept");
  assert.equal(noEpubCover.hasChanges, false);

  // The flag changes nothing for a Gutenberg cover.
  const gutenberg = "https://covers.example/covers/test-book-7-000000000000.jpg";
  assert.deepEqual(
    buildImportDiff(withCover(gutenberg), withEpubCover({ replaceCustomCover: true })).metadata,
    buildImportDiff(withCover(gutenberg), withEpubCover()).metadata,
  );
});

test("COVER: the digest is stable and records the custom-cover decision", () => {
  const kept = digestOf(withCover(customUrl), withEpubCover());
  assert.equal(digestOf(withCover(customUrl), withEpubCover()), kept, "deterministic");

  const replaced = digestOf(withCover(customUrl), withEpubCover({ replaceCustomCover: true }));
  const otherCustom = digestOf(
    withCover("https://covers.example/covers/libra/test-book-7-111111111111.jpg"),
    withEpubCover(),
  );
  assert.equal(new Set([kept, replaced, otherCustom]).size, 3);

  // A digest reviewed with the cover kept does not authorize the write that replaces it.
  const current = withCover(customUrl, "PUBLISHED");
  const plan = withEpubCover({ replaceCustomCover: true });
  const violations = evaluateImportPolicy({
    diff: buildImportDiff(current, plan),
    digest: digestOf(current, plan),
    extractionWarnings: [],
    slugWasExplicit: true,
    flags: { ...defaultImportFlags, revisePublished: true, planHash: digestOf(current, withEpubCover()) },
  });
  assert(violations.some((violation) => violation.includes("does not match the current plan")));
});

test("COVER: only a file directly under covers/libra/ is a custom cover; Hound's Gutenberg cover is not", () => {
  assert.equal(isCustomCoverUrl(customUrl), true);
  assert.equal(isCustomCoverUrl("https://cdn.example/books/covers/libra/a-1-0123456789ab.webp"), true);
  for (const url of [
    null,
    undefined,
    "",
    "not a url",
    "https://covers.example/covers/the-hound-of-the-baskervilles-2852-0123456789ab.jpg",
    // A book whose slug starts with "libra" keeps the importer's key shape.
    "https://covers.example/covers/libra-1-0123456789ab.jpg",
    "https://covers.example/covers/libra/",
    "https://covers.example/covers/libra/nested/a.jpg",
    "https://covers.example/other/libra/a.jpg",
  ]) {
    assert.equal(isCustomCoverUrl(url), false, String(url));
  }

  // Re-importing Hound with its own stored cover plans nothing; with a newer EPUB cover it updates as before.
  const houndKey = "covers/the-hound-of-the-baskervilles-2852-0123456789ab.jpg";
  const hound = state({
    book: { id: "book-h", slug: "the-hound-of-the-baskervilles" },
    edition: { ...state().edition!, bookId: "book-h", coverUrl: `https://covers.example/${houndKey}` },
  });
  const houndPlan = (coverKey: string) => {
    const plan = input(unchangedChapters, { bookSlug: "the-hound-of-the-baskervilles", replaceCustomCover: true });
    return { ...plan, incoming: { ...plan.incoming, coverKey } };
  };
  const kept = buildImportDiff(hound, houndPlan(houndKey));
  assert.equal(kept.customCover, null);
  assert.equal(
    kept.metadata.some((change) => change.field === "cover"),
    false,
  );
  const updated = buildImportDiff(hound, houndPlan("covers/the-hound-of-the-baskervilles-2852-ffffffffffff.jpg"));
  assert.equal(
    updated.metadata.some((change) => change.field === "cover"),
    true,
  );
});
