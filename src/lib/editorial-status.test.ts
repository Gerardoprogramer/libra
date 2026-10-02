import assert from "node:assert/strict";
import { test } from "node:test";

import { isPublicCopyrightStatus, isPublicEditionStatus } from "./editorial-status";
import { chooseEdition } from "./edition-selection";

test("publication and copyright visibility are independently required for each edition", () => {
  assert.equal(isPublicEditionStatus("PUBLISHED", "PUBLIC_DOMAIN_VERIFIED"), true);
  assert.equal(isPublicEditionStatus("PUBLISHED", "LICENSED"), true);
  assert.equal(isPublicEditionStatus("PUBLISHED", "ORIGINAL"), true);
  assert.equal(isPublicEditionStatus("DRAFT", "PUBLIC_DOMAIN_VERIFIED"), false);
  assert.equal(isPublicEditionStatus("ARCHIVED", "LICENSED"), false);
  assert.equal(isPublicEditionStatus("PUBLISHED", "PENDING_REVIEW"), false);
  assert.equal(isPublicEditionStatus("PUBLISHED", "REJECTED"), false);
});

test("public edition selection excludes draft, rejected, archived, and pending editions", () => {
  const editions = [
    {
      slug: "draft",
      language: "es",
      publicationStatus: "DRAFT",
      copyrightStatus: "LICENSED",
      isPreferred: false,
      createdAt: new Date("2020-01-01"),
    },
    {
      slug: "rejected",
      language: "es",
      publicationStatus: "PUBLISHED",
      copyrightStatus: "REJECTED",
      isPreferred: false,
      createdAt: new Date("2020-01-01"),
    },
    {
      slug: "archived",
      language: "es",
      publicationStatus: "ARCHIVED",
      copyrightStatus: "LICENSED",
      isPreferred: false,
      createdAt: new Date("2020-01-01"),
    },
    {
      slug: "pending",
      language: "es",
      publicationStatus: "PUBLISHED",
      copyrightStatus: "PENDING_REVIEW",
      isPreferred: false,
      createdAt: new Date("2020-01-01"),
    },
    {
      slug: "published",
      language: "es",
      publicationStatus: "PUBLISHED",
      copyrightStatus: "PUBLIC_DOMAIN_VERIFIED",
      isPreferred: false,
      createdAt: new Date("2020-01-01"),
    },
  ];
  const publicEditions = editions.filter((edition) =>
    isPublicEditionStatus(edition.publicationStatus, edition.copyrightStatus),
  );

  assert.equal(chooseEdition(publicEditions, "es")?.slug, "published");
});

test("copyright review only accepts explicitly verified publishable classifications", () => {
  assert.equal(isPublicCopyrightStatus("PUBLIC_DOMAIN_VERIFIED"), true);
  assert.equal(isPublicCopyrightStatus("LICENSED"), true);
  assert.equal(isPublicCopyrightStatus("ORIGINAL"), true);
  assert.equal(isPublicCopyrightStatus("PENDING_REVIEW"), false);
  assert.equal(isPublicCopyrightStatus("REJECTED"), false);
});

test("an ineligible preferred edition cannot displace a public fallback", () => {
  for (const [publicationStatus, copyrightStatus] of [
    ["DRAFT", "PUBLIC_DOMAIN_VERIFIED"],
    ["PUBLISHED", "PENDING_REVIEW"],
    ["PUBLISHED", "REJECTED"],
  ]) {
    const hidden = {
      slug: "hidden-preferred",
      language: "es",
      isPreferred: true,
      createdAt: new Date("2019-01-01"),
      publicationStatus,
      copyrightStatus,
    };
    const visible = {
      ...hidden,
      slug: "public-fallback",
      isPreferred: false,
      publicationStatus: "PUBLISHED",
      copyrightStatus: "LICENSED",
    };
    const publicEditions = [hidden, visible].filter((edition) =>
      isPublicEditionStatus(edition.publicationStatus, edition.copyrightStatus),
    );
    assert.equal(chooseEdition(publicEditions, "es")?.slug, "public-fallback");
    assert.equal(
      chooseEdition(
        publicEditions.filter((edition) => edition.isPreferred),
        "es",
      ),
      undefined,
    );
  }
});
