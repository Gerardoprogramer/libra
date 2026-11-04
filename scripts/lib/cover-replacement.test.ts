import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import sharp from "sharp";

import { parseMediaBase, type MediaBase } from "./cover-origin-migration";
import { isCustomCoverUrl } from "./custom-cover";
import {
  applyCoverReplacement,
  checkCoverImage,
  CoverReplacementRefusedError,
  maximumCoverBytes,
  parseReplaceCoverArguments,
  planCoverReplacement,
  verifyPublicBase,
  type CoverReplacementDependencies,
  type ReplacementEdition,
} from "./cover-replacement";

// Pure planning plus the committed cover file: no database, R2 or network access.
const base = parseMediaBase("https://covers.example.com", "R2_PUBLIC_URL");
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

const edition: ReplacementEdition = {
  id: "edition-1",
  bookSlug: "wuthering-heights",
  sourceIdentifier: "768",
  coverUrl: "https://covers.example.com/covers/wuthering-heights-768-0123456789ab.jpg",
};

test("covers are recognized by their bytes and must be a 2:3 portrait at least 600px wide", () => {
  assert.deepEqual(checkCoverImage(jpeg, { width: 1600, height: 2400 }), {
    mediaType: "image/jpeg",
    extension: "jpg",
    width: 1600,
    height: 2400,
  });
  assert.throws(() => checkCoverImage(Buffer.from("GIF89a"), { width: 1600, height: 2400 }), /JPEG, PNG or WebP/);
  assert.throws(() => checkCoverImage(jpeg, {}), /dimensions/);
  assert.throws(() => checkCoverImage(jpeg, { width: 400, height: 600 }), /at least 600px/);
  assert.throws(() => checkCoverImage(jpeg, { width: 1600, height: 1600 }), /2:3/);
});

test("the new cover gets a content-addressed key under covers/libra/, below the public base", () => {
  const plan = planCoverReplacement({
    edition,
    expectedBook: "wuthering-heights",
    data: jpeg,
    image: { extension: "jpg" },
    publicBase: base,
  });
  const hash = createHash("sha256").update(jpeg).digest("hex").slice(0, 12);

  assert.equal(plan.key, `covers/libra/wuthering-heights-768-${hash}.jpg`);
  assert.equal(plan.url, `https://covers.example.com/${plan.key}`);
  assert.equal(isCustomCoverUrl(plan.url), true, "a re-import keeps it");
  assert.equal(plan.previousUrl, edition.coverUrl);
  assert.equal(plan.unchanged, false);

  const again = planCoverReplacement({
    edition: { ...edition, coverUrl: plan.url },
    expectedBook: "wuthering-heights",
    data: jpeg,
    image: { extension: "jpg" },
    publicBase: base,
  });
  assert.equal(again.unchanged, true);
});

test("an edition of another book is refused, so a wrong Gutenberg id cannot replace its cover", () => {
  assert.throws(
    () =>
      planCoverReplacement({
        edition: { ...edition, bookSlug: "the-hound-of-the-baskervilles", sourceIdentifier: "2852" },
        expectedBook: "wuthering-heights",
        data: jpeg,
        image: { extension: "jpg" },
        publicBase: base,
      }),
    /belongs to book "the-hound-of-the-baskervilles"/,
  );
});

test("the committed Wuthering Heights cover is a 1600x2400 JPEG the replacement accepts", async () => {
  const data = await readFile("scripts/covers/wuthering-heights.jpg");
  const metadata = await sharp(data).metadata();

  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.space, "srgb");
  assert.deepEqual(checkCoverImage(data, metadata), {
    mediaType: "image/jpeg",
    extension: "jpg",
    width: 1600,
    height: 2400,
  });
  assert.ok(data.length < 512 * 1024, `${data.length} bytes`);
});

const dryRun = [
  "--gutenberg-id",
  "768",
  "--book",
  "wuthering-heights",
  "--file",
  "scripts/covers/wuthering-heights.jpg",
];
const current = "https://covers.example.com/covers/wuthering-heights-768-0123456789ab.jpg";

test("the documented dry run and write parse, with or without pnpm's separator", () => {
  const expected = {
    help: false,
    gutenbergId: "768",
    bookSlug: "wuthering-heights",
    file: "scripts/covers/wuthering-heights.jpg",
    apply: false,
  };
  assert.deepEqual(parseReplaceCoverArguments(dryRun), expected);
  assert.deepEqual(parseReplaceCoverArguments(["--", ...dryRun]), expected);
  assert.deepEqual(
    parseReplaceCoverArguments([...dryRun, "--apply", "--expect-current", current, "--confirm-database=abc123"]),
    { ...expected, apply: true, expectCurrent: current, confirmDatabase: "abc123" },
  );
  assert.deepEqual(
    parseReplaceCoverArguments([
      ...dryRun,
      "--apply",
      "--expect-current=none",
      "--expect-base",
      "https://covers.example.com/",
    ]),
    { ...expected, apply: true, expectCurrent: null, expectBase: base },
  );
  // A dry run may already carry the anchor, to check it.
  assert.equal(parseReplaceCoverArguments([...dryRun, "--expect-current", current]).expectCurrent, current);
});

test("a file path, a repeated option or a malformed id is refused before any database access", () => {
  const replace = (option: string, value: string) =>
    dryRun.map((argument, index) => (dryRun[index - 1] === option ? value : argument));

  assert.throws(
    () => parseReplaceCoverArguments(replace("--book", "scripts/covers/wuthering-heights.jpg")),
    /book slug/,
  );
  assert.throws(() => parseReplaceCoverArguments(replace("--book", "Wuthering Heights")), /book slug/);
  assert.throws(() => parseReplaceCoverArguments([...dryRun, "--book", "the-hound-of-the-baskervilles"]), /2 times/);
  assert.throws(() => parseReplaceCoverArguments([...dryRun, "--gutenberg-id", "2852"]), /2 times/);
  for (const id of ["0768", "768a", "-1", "7.68"]) {
    assert.throws(() => parseReplaceCoverArguments(replace("--gutenberg-id", id)), /gutenberg-id/, id);
  }
  assert.throws(
    () => parseReplaceCoverArguments(["--book=--file", "--gutenberg-id", "768", "--file", "x"]),
    /needs a value/,
  );
  assert.throws(() => parseReplaceCoverArguments(dryRun.filter((_, index) => index < 4)), /--file is required/);
  assert.throws(() => parseReplaceCoverArguments([...dryRun, "wuthering-heights"]), /positional/i);
  assert.throws(
    () => parseReplaceCoverArguments([...dryRun, "--confirm-database", "abc123"]),
    /only used with --apply/,
  );
});

test("B3: --apply cannot omit --expect-current, and its value is validated before any database access", () => {
  assert.throws(() => parseReplaceCoverArguments([...dryRun, "--apply"]), /--apply requires --expect-current/);
  assert.throws(
    () => parseReplaceCoverArguments([...dryRun, "--apply", "--confirm-database", "abc123"]),
    /--apply requires --expect-current/,
  );
  const apply = (...extra: string[]) => parseReplaceCoverArguments([...dryRun, "--apply", ...extra]);
  assert.throws(() => apply("--expect-current", current, "--expect-current", "none"), /2 times/);
  for (const value of ["", " ", "--confirm-database", "-x"]) {
    assert.throws(() => apply(`--expect-current=${value}`), /needs a value/, JSON.stringify(value));
  }
  assert.throws(() => apply("--expect-current"), /argument missing|needs a value/i);
  for (const value of ["None", "null", "covers/x.jpg", "http://covers.example.com/covers/x.jpg"]) {
    assert.throws(() => apply("--expect-current", value), /--expect-current must/, value);
  }
  assert.throws(() => apply("--expect-current", "https://user:pass@covers.example.com/covers/x.jpg"), /credentials/);
});

test("B2: --expect-base is validated like R2_PUBLIC_URL and given once", () => {
  for (const value of ["http://covers.example.com", "not a url", "https://covers.example.com/?a=1"]) {
    assert.throws(() => parseReplaceCoverArguments([...dryRun, "--expect-base", value]), /--expect-base/, value);
  }
  assert.throws(() => parseReplaceCoverArguments([...dryRun, "--expect-base="]), /needs a value/);
  assert.throws(
    () => parseReplaceCoverArguments([...dryRun, "--expect-base", base.href, "--expect-base", "https://other.example"]),
    /2 times/,
  );
});

test("a cover over the social-card limit or turned by EXIF orientation is refused", () => {
  const large = Buffer.concat([jpeg, Buffer.alloc(maximumCoverBytes)]);
  assert.throws(() => checkCoverImage(large, { width: 1600, height: 2400 }), /at most/);
  // Stored 2400x1600 with orientation 6 displays as 1600x2400: accepted, reported as displayed.
  assert.equal(checkCoverImage(jpeg, { width: 2400, height: 1600, orientation: 6 }).width, 1600);
  // Stored 1600x2400 with orientation 8 displays as a landscape.
  assert.throws(() => checkCoverImage(jpeg, { width: 1600, height: 2400, orientation: 8 }), /2:3/);
});

test("B2: the public base is checked against the current cover, or confirmed when there is none", () => {
  const plan = (coverUrl: string | null, expectedBase?: MediaBase) =>
    planCoverReplacement({
      edition: { ...edition, coverUrl },
      expectedBook: "wuthering-heights",
      data: jpeg,
      image: { extension: "jpg" },
      publicBase: base,
      expectedBase,
    });
  const other = parseMediaBase("https://pub-0123.r2.dev", "--expect-base");

  // Matching base: the current cover is under R2_PUBLIC_URL; a confirmation, if given, must agree too.
  assert.equal(plan(current).previousUrl, current);
  assert.equal(plan(current, base).previousUrl, current);
  assert.throws(() => plan(current, other), /--expect-base https:\/\/pub-0123\.r2\.dev does not match/);
  // Different base: the stored cover is under another base.
  assert.throws(() => plan("https://pub-0123.r2.dev/covers/wuthering-heights-768-0123456789ab.jpg"), /R2_PUBLIC_URL/);
  // Unverifiable: a stored URL that is not a cover URL, or no cover and no confirmation.
  assert.throws(() => plan("https://elsewhere.example/image.jpg"), /R2_PUBLIC_URL/);
  assert.throws(() => plan(null), /no cover to check R2_PUBLIC_URL[\s\S]*--expect-base https:\/\/covers\.example\.com/);
  // Edition without a cover: only the confirmed, configured base is accepted.
  assert.equal(plan(null, base).previousUrl, null);
  assert.throws(() => plan(null, other), /does not match R2_PUBLIC_URL/);
  // Every refusal is a CoverReplacementRefusedError (nothing was written).
  assert.throws(() => plan(null), CoverReplacementRefusedError);
  assert.throws(() => verifyPublicBase({ publicBase: base, currentCoverUrl: null }), CoverReplacementRefusedError);
});

test("the committed cover maps to the documented key covers/libra/wuthering-heights-768-c6ef0ae66adb.jpg", async () => {
  const data = await readFile("scripts/covers/wuthering-heights.jpg");
  const plan = planCoverReplacement({
    edition,
    expectedBook: "wuthering-heights",
    data,
    image: { extension: "jpg" },
    publicBase: base,
  });
  assert.equal(plan.key, "covers/libra/wuthering-heights-768-c6ef0ae66adb.jpg");
});

/** An in-memory edition row and R2 bucket behind applyCoverReplacement's dependencies. */
function harness({
  failUpload = false,
  failUpdate,
  changeUnderLock,
  start = { ...edition },
}: {
  failUpload?: boolean;
  /** "unknown": the connection drops during the update; "after-commit": it drops after the COMMIT went through. */
  failUpdate?: "unknown" | "after-commit";
  changeUnderLock?: string;
  start?: ReplacementEdition;
} = {}) {
  const bucket = new Map<string, Buffer>();
  const uploads: string[] = [];
  const updates: string[] = [];
  const revalidations: string[][] = [];
  const errors: string[] = [];
  const state = { row: { ...start }, failUpdate };

  const dependencies: CoverReplacementDependencies = {
    async upload(input) {
      if (failUpload) throw new Error("R2 unavailable");
      const hash = createHash("sha256").update(input.data).digest("hex").slice(0, 12);
      const key = `covers/libra/${input.bookSlug}-${input.gutenbergId}-${hash}.${input.extension}`;
      bucket.set(key, input.data);
      uploads.push(key);
      return `${base.href}/${key}`;
    },
    async withLockedEdition(write) {
      // A transaction on a copy of the row: committed only if `write` resolves.
      const draft = { ...state.row, ...(changeUnderLock !== undefined ? { coverUrl: changeUnderLock } : {}) };
      await write(draft, async (url, previousUrl) => {
        if (state.failUpdate === "unknown") throw new Error("connection reset");
        if (draft.coverUrl !== previousUrl) return 0;
        draft.coverUrl = url;
        updates.push(url);
        return 1;
      });
      state.row = draft;
      if (state.failUpdate === "after-commit") throw new Error("connection lost during COMMIT");
    },
    async revalidate(tags) {
      revalidations.push(tags);
      return true;
    },
    log: () => {},
    error: (line) => errors.push(line),
  };

  const run = (expectedCurrent: string | null = start.coverUrl) =>
    applyCoverReplacement(
      {
        plan: planCoverReplacement({
          edition: state.row,
          expectedBook: "wuthering-heights",
          data: jpeg,
          image: { extension: "jpg" },
          publicBase: base,
          expectedBase: base,
        }),
        edition: state.row,
        expectedBook: "wuthering-heights",
        expectedCurrent,
        data: jpeg,
        image: { extension: "jpg", mediaType: "image/jpeg" },
        publicBase: base,
        expectedBase: base,
      },
      dependencies,
    );

  return { state, bucket, uploads, updates, revalidations, errors, run };
}

const tags = ["library", "book:wuthering-heights"];

test("apply: upload, then the locked write, then cache invalidation", async () => {
  const h = harness();
  assert.equal(await h.run(), "applied");
  assert.equal(h.uploads.length, 1);
  assert.deepEqual(h.updates, [`${base.href}/${h.uploads[0]}`]);
  assert.equal(h.state.row.coverUrl, `${base.href}/${h.uploads[0]}`);
  assert.deepEqual(h.revalidations, [tags]);
});

test("apply: an edition without a cover is written with --expect-current none", async () => {
  const h = harness({ start: { ...edition, coverUrl: null } });
  await assert.rejects(h.run(current), /current cover is none, not the expected/);
  assert.equal(await h.run(null), "applied");
  assert.equal(h.state.row.coverUrl, `${base.href}/${h.uploads[0]}`);
});

test("apply: a failed upload writes nothing and invalidates nothing", async () => {
  const h = harness({ failUpload: true });
  await assert.rejects(h.run(), /R2 unavailable/);
  assert.equal(h.state.row.coverUrl, edition.coverUrl);
  assert.deepEqual(h.updates, []);
  assert.deepEqual(h.revalidations, []);
});

test("B1: a failure that may follow the commit says the object may be referenced and how to confirm", async () => {
  const h = harness({ failUpdate: "unknown" });
  await assert.rejects(h.run(), /connection reset/);
  assert.equal(h.state.row.coverUrl, edition.coverUrl, "rolled back");
  assert.equal(h.bucket.size, 1, "the uploaded object stays");
  assert.deepEqual(h.revalidations, []);
  const message = h.errors.join("\n");
  assert.match(message, /may or may not reference it/);
  assert.match(message, /Run the same command again to confirm the state/);
  assert.doesNotMatch(message, /no edition references it/);

  // The retry (same --expect-current) uploads to the same key and writes once.
  h.state.failUpdate = undefined;
  assert.equal(await h.run(), "applied");
  assert.equal(h.uploads[1], h.uploads[0], "the retry uploads to the same key");
  assert.equal(h.bucket.size, 1);
  assert.deepEqual(h.updates, [`${base.href}/${h.uploads[0]}`]);
  assert.deepEqual(h.revalidations, [tags]);
});

test("B1: a commit that reached the database before the connection dropped is confirmed by the rerun", async () => {
  const h = harness({ failUpdate: "after-commit" });
  await assert.rejects(h.run(), /connection lost during COMMIT/);
  // The write did commit: the edition references the object, which the message allowed for.
  assert.equal(h.state.row.coverUrl, `${base.href}/${h.uploads[0]}`);
  assert.match(h.errors.join("\n"), /may or may not reference it/);
  assert.deepEqual(h.revalidations, []);

  // The rerun with the reviewed --expect-current (the old URL) finds the intended image: no upload, no write, and
  // the cache that the failed run did not invalidate is invalidated now.
  h.state.failUpdate = undefined;
  assert.equal(await h.run(edition.coverUrl), "unchanged");
  assert.equal(h.uploads.length, 1);
  assert.equal(h.updates.length, 1);
  assert.deepEqual(h.revalidations, [tags]);
});

test("B1: a check that refuses the write inside the transaction still says plainly that nothing was written", async () => {
  const h = harness({ changeUnderLock: "https://covers.example.com/covers/wuthering-heights-768-999999999999.jpg" });
  await assert.rejects(h.run(), /changed since it was read/);
  assert.match(h.errors.join("\n"), /Nothing was written; .* no edition references it/);
  assert.doesNotMatch(h.errors.join("\n"), /may or may not/);
});

test("B3: a cover other than the expected one is never overwritten: no upload, no write, no invalidation", async () => {
  const other = "https://covers.example.com/covers/wuthering-heights-768-999999999999.jpg";

  // Changed between the dry run and --apply: refused before the upload.
  const before = harness();
  await assert.rejects(before.run(other), /not the expected .*999999999999[\s\S]*Nothing was uploaded or written/);
  assert.deepEqual(before.uploads, []);
  assert.deepEqual(before.updates, []);
  assert.deepEqual(before.revalidations, []);
  await assert.rejects(before.run(null), /not the expected none/);

  // Changed after the read, under the lock: refused before the update; the uploaded object stays unreferenced.
  const under = harness({ changeUnderLock: other });
  await assert.rejects(under.run(), /changed since it was read/);
  assert.equal(under.state.row.coverUrl, edition.coverUrl);
  assert.deepEqual(under.updates, []);
  assert.deepEqual(under.revalidations, []);
});

test("B3: an already applied replacement stays idempotent whatever the anchor, since its URL is the intended one", async () => {
  const h = harness();
  assert.equal(await h.run(), "applied");
  const applied = h.state.row.coverUrl;
  // The URL is derived from these bytes, this book and this id: it is the target, not an unexpected change.
  for (const anchor of [edition.coverUrl, applied, null]) {
    assert.equal(await h.run(anchor), "unchanged");
  }
  assert.equal(h.uploads.length, 1);
  assert.equal(h.updates.length, 1);
  assert.equal(h.state.row.coverUrl, applied);
});

test("apply: a lock that finds another book's edition, such as Hound's, writes nothing", async () => {
  const plan = planCoverReplacement({
    edition,
    expectedBook: "wuthering-heights",
    data: jpeg,
    image: { extension: "jpg" },
    publicBase: base,
  });
  const hound: ReplacementEdition = {
    id: "edition-hound",
    bookSlug: "the-hound-of-the-baskervilles",
    sourceIdentifier: "2852",
    coverUrl: "https://covers.example.com/covers/the-hound-of-the-baskervilles-2852-0123456789ab.jpg",
  };
  let written = false;
  await assert.rejects(
    applyCoverReplacement(
      {
        plan,
        edition,
        expectedBook: "wuthering-heights",
        expectedCurrent: edition.coverUrl,
        data: jpeg,
        image: { extension: "jpg", mediaType: "image/jpeg" },
        publicBase: base,
      },
      {
        upload: async () => plan.url,
        withLockedEdition: async (write) =>
          write(hound, async () => {
            written = true;
            return 1;
          }),
        revalidate: async () => true,
        log: () => {},
        error: () => {},
      },
    ),
    /belongs to book "the-hound-of-the-baskervilles"/,
  );
  assert.equal(written, false);
});
