import assert from "node:assert/strict";
import { test } from "node:test";

import { planCategoryAdditions, type ExistingAssignment } from "./category-additions";

const existing: ExistingAssignment[] = [
  { bookSlug: "dracula", categorySlug: "classic-literature", position: 0 },
  { bookSlug: "dracula", categorySlug: "gothic-fiction", position: 1 },
  { bookSlug: "dracula", categorySlug: "horror", position: 2 },
  { bookSlug: "jane-eyre", categorySlug: "gothic-fiction", position: 0 },
];

test("only the listed books get relations, after the ones they already have", () => {
  const additions = planCategoryAdditions(
    { "jane-eyre": ["classic-literature", "romance"], niebla: ["classic-literature"] },
    existing,
  );

  assert.deepEqual(additions, [
    { bookSlug: "jane-eyre", categorySlug: "classic-literature", position: 1 },
    { bookSlug: "jane-eyre", categorySlug: "romance", position: 2 },
    { bookSlug: "niebla", categorySlug: "classic-literature", position: 0 },
  ]);
  // Another book's categories are never part of the plan, and nothing is ever removed: the plan only adds rows.
  assert.ok(additions.every((addition) => addition.bookSlug !== "dracula"));
});

test("a category the book already has is kept as it is, and a category not listed is not removed", () => {
  assert.deepEqual(planCategoryAdditions({ dracula: ["classic-literature", "horror"] }, existing), []);
  assert.deepEqual(planCategoryAdditions({ "jane-eyre": ["romance"] }, existing), [
    { bookSlug: "jane-eyre", categorySlug: "romance", position: 1 },
  ]);
});

test("planning again against the result adds nothing", () => {
  const requested = { "jane-eyre": ["classic-literature", "romance"], trafalgar: ["classic-literature"] };
  const first = planCategoryAdditions(requested, existing);
  assert.equal(first.length, 3);

  assert.deepEqual(planCategoryAdditions(requested, [...existing, ...first]), []);
});

test("a category listed twice for a book is refused", () => {
  assert.throws(
    () => planCategoryAdditions({ niebla: ["classic-literature", "classic-literature"] }, []),
    /Duplicate categories for niebla: classic-literature/,
  );
});
