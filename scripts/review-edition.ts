import os from "node:os";

import { config } from "dotenv";
import { and, count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { bookAuthors, books, chapters, editionReviews, editions } from "../src/db/schema";

import { parseEditionReviewArguments } from "./lib/review-edition-args";
import { findPublicationProblems } from "./lib/review-edition-checks";
import { formatImportError, isMissingRelation } from "./lib/import-errors";
import { revalidateEditorialCache } from "./lib/revalidate-cache";
import {
  assertEditionCanBePreferred,
  getArchivedEditionUpdate,
  getRejectedEditionUpdate,
} from "./lib/review-edition-state";
import { assertWriteAllowed, sslFor } from "./lib/write-guard";

config({
  path: ".env.local",
});

if (!process.env.DIRECT_DATABASE_URL) {
  throw new Error("DIRECT_DATABASE_URL is not defined");
}

const args = process.argv.slice(2);
const { sourceName, sourceIdentifier, notes, action, copyrightStatus } = parseEditionReviewArguments(args);

// Showing an edition is read-only; every other action writes and must name its target database.
if (action !== "show") {
  assertWriteAllowed({
    connectionString: process.env.DIRECT_DATABASE_URL,
    args,
    script: "db:review",
    allowRemote: true,
  });
}

const client = postgres(process.env.DIRECT_DATABASE_URL, {
  max: 1,
  prepare: false,
  ssl: sslFor(process.env.DIRECT_DATABASE_URL),
});

const db = drizzle(client);

type Executor = Pick<typeof db, "select" | "insert" | "update">;

async function getEdition(executor: Executor, lock = false) {
  const query = executor
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

  // Lock the edition row so a concurrent import or review cannot change it between the checks and the write.
  const [edition] = lock ? await query.for("update", { of: editions }) : await query;

  return edition;
}

type Edition = NonNullable<Awaited<ReturnType<typeof getEdition>>>;
type Facts = Awaited<ReturnType<typeof getFacts>>;

async function getFacts(executor: Executor, edition: Edition) {
  const [stats] = await executor
    .select({
      chapterCount: sql<number>`count(*)::int`,
      emptyChapterCount: sql<number>`(count(*) filter (where btrim(${chapters.content}) = ''))::int`,
      wordCount: sql<number>`coalesce(sum(coalesce(${chapters.wordCount}, 0)), 0)::int`,
    })
    .from(chapters)
    .where(eq(chapters.editionId, edition.id));

  const [authorStats] = await executor
    .select({ authorCount: count() })
    .from(bookAuthors)
    .where(eq(bookAuthors.bookId, edition.bookId));

  return {
    chapterCount: stats?.chapterCount ?? 0,
    emptyChapterCount: stats?.emptyChapterCount ?? 0,
    wordCount: stats?.wordCount ?? 0,
    authorCount: authorStats?.authorCount ?? 0,
  };
}

function printEdition(edition: Edition, facts: Facts) {
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

  console.log(`Chapters: ${facts.chapterCount} (${facts.emptyChapterCount} empty), ${facts.wordCount} words`);

  console.log(`Authors linked to the book: ${facts.authorCount}`);

  console.log(`Copyright: ${edition.copyrightStatus}`);

  console.log(`Publication: ${edition.publicationStatus}`);

  console.log(`Verified at: ${edition.verifiedAt?.toISOString() ?? "-"}`);

  console.log(`Notes: ${edition.copyrightNotes ?? "-"}`);

  console.log("");
}

/**
 * Applies one editorial decision. The edition is locked and its facts re-read inside the transaction, and the
 * audit record is written in the same transaction: a decision without its trail cannot be committed. This needs
 * migration 0008_edition_reviews to be applied first; without the table the transaction fails and nothing changes.
 */
async function decide(
  decision: "PUBLISH" | "REJECT" | "ARCHIVE",
  buildUpdate: (edition: Edition) => Partial<typeof editions.$inferInsert>,
) {
  return db.transaction(async (tx) => {
    const edition = await getEdition(tx, true);

    if (!edition) {
      throw new Error(`No edition found for source ${sourceName} with identifier ${sourceIdentifier}`);
    }

    const facts = await getFacts(tx, edition);

    if (decision === "PUBLISH") {
      const problems = findPublicationProblems({
        title: edition.title,
        language: edition.language,
        notes,
        ...facts,
      });

      if (problems.length) {
        throw new Error(`Cannot publish: ${problems.join("; ")}.`);
      }
    }

    const [updated] = await tx
      .update(editions)
      .set(buildUpdate(edition))
      .where(eq(editions.id, edition.id))
      .returning();

    await tx.insert(editionReviews).values({
      editionId: edition.id,
      action: decision,
      previousPublicationStatus: edition.publicationStatus,
      newPublicationStatus: updated.publicationStatus,
      previousCopyrightStatus: edition.copyrightStatus,
      newCopyrightStatus: updated.copyrightStatus,
      notes: notes ?? null,
      chapterCount: facts.chapterCount,
      wordCount: facts.wordCount,
      reviewer: os.userInfo().username,
    });

    return updated;
  });
}

async function main() {
  const edition = await getEdition(db);

  if (!edition) {
    throw new Error(`No edition found for source ${sourceName} with identifier ${sourceIdentifier}`);
  }

  printEdition(edition, await getFacts(db, edition));

  if (action === "show") {
    console.log("No changes made. Use --publish, --reject, --archive or --prefer.");

    return;
  }

  if (action === "publish") {
    if (!copyrightStatus) {
      throw new Error("Publishing requires an explicitly reviewed copyright status.");
    }

    const updated = await decide("PUBLISH", () => ({
      copyrightStatus,
      publicationStatus: "PUBLISHED",

      verifiedAt: new Date(),

      copyrightNotes: notes,

      updatedAt: new Date(),
    }));

    console.log("Edition verified and published (decision recorded in edition_reviews).");

    console.log(`Copyright: ${updated.copyrightStatus}`);

    console.log(`Publication: ${updated.publicationStatus}`);

    await revalidateEditorialCache([`book:${edition.bookSlug}`, "library"]);

    return;
  }

  if (action === "reject") {
    const updated = await decide("REJECT", () => getRejectedEditionUpdate(notes, new Date()));

    console.log("Edition rejected.");

    console.log(`Copyright: ${updated.copyrightStatus}`);

    await revalidateEditorialCache([`book:${edition.bookSlug}`, "library"]);

    return;
  }

  if (action === "archive") {
    const updated = await decide("ARCHIVE", () => getArchivedEditionUpdate(new Date()));

    console.log("Edition archived.");

    console.log(`Publication: ${updated.publicationStatus}`);

    await revalidateEditorialCache([`book:${edition.bookSlug}`, "library"]);

    return;
  }

  assertEditionCanBePreferred(edition.publicationStatus, edition.copyrightStatus);

  const language = edition.language.split("-")[0].toLowerCase();

  await db.transaction(async (tx) => {
    const locked = await getEdition(tx, true);

    if (!locked) {
      throw new Error(`No edition found for source ${sourceName} with identifier ${sourceIdentifier}`);
    }

    // Re-checked under lock: it may have been archived or rejected since it was displayed.
    assertEditionCanBePreferred(locked.publicationStatus, locked.copyrightStatus);

    const facts = await getFacts(tx, locked);

    await tx
      .update(editions)
      .set({
        isPreferred: false,
        updatedAt: new Date(),
      })
      .where(
        and(eq(editions.bookId, locked.bookId), sql`lower(split_part(${editions.language}, '-', 1)) = ${language}`),
      );

    await tx
      .update(editions)
      .set({
        isPreferred: true,
        updatedAt: new Date(),
      })
      .where(eq(editions.id, locked.id));

    await tx.insert(editionReviews).values({
      editionId: locked.id,
      action: "PREFER",
      previousPublicationStatus: locked.publicationStatus,
      newPublicationStatus: locked.publicationStatus,
      previousCopyrightStatus: locked.copyrightStatus,
      newCopyrightStatus: locked.copyrightStatus,
      notes: notes ?? null,
      chapterCount: facts.chapterCount,
      wordCount: facts.wordCount,
      reviewer: os.userInfo().username,
    });
  });

  console.log("Preferred edition updated.");

  await revalidateEditorialCache([`book:${edition.bookSlug}`, "library"]);
}

main()
  .catch((error) => {
    console.error("");
    console.error("Edition review failed");
    console.error(formatImportError(error));

    if (isMissingRelation(error, "edition_reviews")) {
      console.error(
        "The edition_reviews table does not exist: apply migration 0008_edition_reviews first. Nothing was changed.",
      );
    }

    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
