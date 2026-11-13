import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertEditionCanBePreferred,
  describeReviewDecision,
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

test("a dry run describes the same changes as the update each action writes", () => {
  const at = new Date("2026-01-01T00:00:00.000Z");
  const rejected = getRejectedEditionUpdate(undefined, at);
  const archived = getArchivedEditionUpdate(at);

  assert.match(describeReviewDecision("publish", "LICENSED"), /copyright LICENSED and publication PUBLISHED/);
  assert.match(
    describeReviewDecision("reject"),
    new RegExp(`copyright ${rejected.copyrightStatus} and publication ${rejected.publicationStatus}`),
  );
  assert.match(describeReviewDecision("archive"), new RegExp(`publication ${archived.publicationStatus}`));
  for (const action of ["publish", "reject", "archive", "prefer"] as const) {
    assert.match(describeReviewDecision(action, "LICENSED"), /would .* record [A-Z]+ in edition_reviews\.$/, action);
  }
});
