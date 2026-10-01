import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertEditionCanBePreferred,
  getArchivedEditionUpdate,
  getRejectedEditionUpdate,
} from "./review-edition-state";

test("rejecting an edition clears only that edition's preference", () => {
  const updatedAt = new Date("2026-01-01T00:00:00.000Z");

  assert.deepEqual(getRejectedEditionUpdate(undefined, updatedAt), {
    copyrightStatus: "REJECTED",
    publicationStatus: "DRAFT",
    isPreferred: false,
    verifiedAt: null,
    copyrightNotes: "Edition rejected during copyright review.",
    updatedAt,
  });
});

test("archiving an edition clears its preference without changing copyright", () => {
  const updatedAt = new Date("2026-01-01T00:00:00.000Z");

  assert.deepEqual(getArchivedEditionUpdate(updatedAt), {
    publicationStatus: "ARCHIVED",
    isPreferred: false,
    updatedAt,
  });
});

test("--prefer rejects editions that are not publicly eligible", () => {
  assert.doesNotThrow(() => assertEditionCanBePreferred("PUBLISHED", "LICENSED"));

  for (const [publicationStatus, copyrightStatus] of [
    ["DRAFT", "PUBLIC_DOMAIN_VERIFIED"],
    ["ARCHIVED", "LICENSED"],
    ["PUBLISHED", "PENDING_REVIEW"],
    ["PUBLISHED", "REJECTED"],
  ]) {
    assert.throws(() => assertEditionCanBePreferred(publicationStatus, copyrightStatus));
  }
});
