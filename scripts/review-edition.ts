import { config } from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { books, editions } from "../src/db/schema";

import { parseEditionReviewArguments } from "./lib/review-edition-args";
import { formatImportError } from "./lib/import-errors";
import { revalidateEditorialCache } from "./lib/revalidate-cache";
import {
  assertEditionCanBePreferred,
  getArchivedEditionUpdate,
  getRejectedEditionUpdate,
} from "./lib/review-edition-state";

config({
  path: ".env.local",
});

if (!process.env.DIRECT_DATABASE_URL) {
  throw new Error("DIRECT_DATABASE_URL is not defined");
}

const { sourceName, sourceIdentifier, notes, action, copyrightStatus } = parseEditionReviewArguments(
  process.argv.slice(2),
);

const client = postgres(process.env.DIRECT_DATABASE_URL, {
  max: 1,
  prepare: false,
  ssl: "require",
});

const db = drizzle(client);

async function getEdition() {
  const [edition] = await db
    .select({
      id: editions.id,

      bookId: books.id,
      bookSlug: books.slug,
      originalTitle: books.originalTitle,

      editionSlug: editions.slug,
      title: editions.title,
      language: editions.language,

      sourceName: editions.sourceName,
      sourceIdentifier: editions.sourceIdentifier,
      sourceUrl: editions.sourceUrl,

      copyrightStatus: editions.copyrightStatus,

      publicationStatus: editions.publicationStatus,

      copyrightNotes: editions.copyrightNotes,

      verifiedAt: editions.verifiedAt,
      coverUrl: editions.coverUrl,
    })
    .from(editions)
    .innerJoin(books, eq(books.id, editions.bookId))
    .where(and(eq(editions.sourceName, sourceName), eq(editions.sourceIdentifier, sourceIdentifier)))
    .limit(1);

  return edition;
}

function printEdition(edition: NonNullable<Awaited<ReturnType<typeof getEdition>>>) {
  console.log("");
  console.log("Edition review");
  console.log("--------------");

  console.log(`Book: ${edition.originalTitle}`);

  console.log(`Edition: ${edition.title}`);

  console.log(`Language: ${edition.language}`);

  console.log(`Book slug: ${edition.bookSlug}`);

  console.log(`Source: ${edition.sourceName}`);

  console.log(`Source ID: ${edition.sourceIdentifier}`);

  console.log(`Source URL: ${edition.sourceUrl ?? "-"}`);

  console.log(`Cover: ${edition.coverUrl ?? "-"}`);

  console.log(`Copyright: ${edition.copyrightStatus}`);

  console.log(`Publication: ${edition.publicationStatus}`);

  console.log(`Verified at: ${edition.verifiedAt?.toISOString() ?? "-"}`);

  console.log(`Notes: ${edition.copyrightNotes ?? "-"}`);

  console.log("");
}

async function main() {
  const edition = await getEdition();

  if (!edition) {
    throw new Error(`No edition found for source ${sourceName} with identifier ${sourceIdentifier}`);
  }

  printEdition(edition);

  if (action === "show") {
    console.log("No changes made. Use --publish, --reject or --archive.");

    return;
  }

  if (action === "publish") {
    if (!copyrightStatus) {
      throw new Error("Publishing requires an explicitly reviewed copyright status.");
    }

    const [updated] = await db
      .update(editions)
      .set({
        copyrightStatus,
        publicationStatus: "PUBLISHED",

        verifiedAt: new Date(),

        copyrightNotes: notes ?? edition.copyrightNotes ?? "Copyright status manually reviewed before publication.",

        updatedAt: new Date(),
      })
      .where(eq(editions.id, edition.id))
      .returning();

    console.log("Edition verified and published.");

    console.log(`Copyright: ${updated.copyrightStatus}`);

    console.log(`Publication: ${updated.publicationStatus}`);

    await revalidateEditorialCache([`book:${edition.bookSlug}`, "library"]);

    return;
  }

  if (action === "reject") {
    const [updated] = await db
      .update(editions)
      .set(getRejectedEditionUpdate(notes, new Date()))
      .where(eq(editions.id, edition.id))
      .returning();

    console.log("Edition rejected.");

    console.log(`Copyright: ${updated.copyrightStatus}`);

    await revalidateEditorialCache([`book:${edition.bookSlug}`, "library"]);

    return;
  }

  if (action === "archive") {
    const [updated] = await db
      .update(editions)
      .set(getArchivedEditionUpdate(new Date()))
      .where(eq(editions.id, edition.id))
      .returning();

    console.log("Edition archived.");

    console.log(`Publication: ${updated.publicationStatus}`);

    await revalidateEditorialCache([`book:${edition.bookSlug}`, "library"]);

    return;
  }

  assertEditionCanBePreferred(edition.publicationStatus, edition.copyrightStatus);

  const language = edition.language.split("-")[0].toLowerCase();

  await db.transaction(async (tx) => {
    await tx
      .update(editions)
      .set({
        isPreferred: false,
        updatedAt: new Date(),
      })
      .where(
        and(eq(editions.bookId, edition.bookId), sql`lower(split_part(${editions.language}, '-', 1)) = ${language}`),
      );

    await tx
      .update(editions)
      .set({
        isPreferred: true,
        updatedAt: new Date(),
      })
      .where(eq(editions.id, edition.id));
  });

  console.log("Preferred edition updated.");

  await revalidateEditorialCache([`book:${edition.bookSlug}`, "library"]);
}

main()
  .catch((error) => {
    console.error("");
    console.error("Edition review failed");
    console.error(formatImportError(error));

    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
