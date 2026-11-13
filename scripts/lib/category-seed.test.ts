import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSeedCategoriesArguments, planCategorySeed } from "./category-seed";

test("db:seed:categories is a dry run unless --apply is given", () => {
  assert.deepEqual(parseSeedCategoriesArguments([]), { apply: false });
  assert.deepEqual(parseSeedCategoriesArguments(["--"]), { apply: false });
  assert.deepEqual(parseSeedCategoriesArguments(["--apply"]), { apply: true });
  assert.deepEqual(parseSeedCategoriesArguments(["--", "--apply", "--confirm-database", "exa..ef"]), { apply: true });
  assert.deepEqual(parseSeedCategoriesArguments(["--confirm-database", "exa..ef", "--apply"]), { apply: true });
});

test("db:seed:categories refuses --confirm-database without --apply, unknown flags and repeated values", () => {
  assert.throws(() => parseSeedCategoriesArguments(["--confirm-database", "exa..ef"]), /only used with --apply/);
  for (const args of [
    ["--apply", "--apply"],
    ["--apply", "--confirm-database"],
    ["--apply", "--confirm-database", ""],
    ["--apply", "--confirm-database", "--apply"],
    ["--apply", "--confirm-database", "a", "--confirm-database", "a"],
    ["--yes"],
    ["--apply", "--"],
  ]) {
    assert.throws(() => parseSeedCategoriesArguments(args), Error, args.join(" "));
  }
});

const definitions = [
  { slug: "horror", en: "Horror", es: "Terror" },
  { slug: "romance", en: "Romance", es: "Romance" },
];

test("the plan lists new categories, changed names and replaced relations, and leaves equal ones unchanged", () => {
  const lines = planCategorySeed(
    definitions,
    { dracula: ["horror"], emma: ["romance"], frankenstein: ["horror", "romance"] },
    [
      { slug: "horror", locale: "en", name: "Horror" },
      { slug: "horror", locale: "es", name: "Horror" },
    ],
    ["horror"],
    [
      { bookSlug: "dracula", categorySlug: "horror", position: 0 },
      { bookSlug: "frankenstein", categorySlug: "romance", position: 0 },
      { bookSlug: "frankenstein", categorySlug: "horror", position: 1 },
    ],
  );

  assert.deepEqual(lines, [
    'would set the es name of horror to "Terror"',
    'would create category romance (en "Romance", es "Romance")',
    "dracula: unchanged (horror)",
    "emma: would replace [] with [romance]",
    "frankenstein: would replace [romance, horror] with [horror, romance]",
  ]);
});

test("a database that already matches the definitions yields no change", () => {
  const lines = planCategorySeed(
    definitions,
    { dracula: ["horror"] },
    [
      { slug: "horror", locale: "en", name: "Horror" },
      { slug: "horror", locale: "es", name: "Terror" },
      { slug: "romance", locale: "en", name: "Romance" },
      { slug: "romance", locale: "es", name: "Romance" },
    ],
    ["horror", "romance"],
    [{ bookSlug: "dracula", categorySlug: "horror", position: 0 }],
  );

  assert.deepEqual(lines, ["dracula: unchanged (horror)"]);
  assert.ok(lines.every((line) => !line.includes("would")));
});
