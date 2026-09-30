import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { books, editions } from "../src/db/schema";

config({
  path: ".env.local",
});

if (!process.env.DIRECT_DATABASE_URL) {
  throw new Error("DIRECT_DATABASE_URL is not defined");
}

type Action = "show" | "publish" | "reject" | "archive";

function getArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

function getRequiredArgument(name: string): string {
  const value = getArgument(name);

  if (!value) {
    throw new Error(`Missing ${name} argument`);
  }

  return value;
}

function getAction(): Action {
  if (process.argv.includes("--publish")) {
    return "publish";
  }

  if (process.argv.includes("--reject")) {
    return "reject";
  }

  if (process.argv.includes("--archive")) {
    return "archive";
  }

  return "show";
}

const gutenbergId = getRequiredArgument("--gutenberg-id");

const notes = getArgument("--notes");
const action = getAction();

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
    .where(and(eq(editions.sourceName, "Project Gutenberg"), eq(editions.sourceIdentifier, gutenbergId)))
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
    throw new Error(`No Project Gutenberg edition found with ID ${gutenbergId}`);
  }

  printEdition(edition);

  if (action === "show") {
    console.log("No changes made. Use --publish, --reject or --archive.");

    return;
  }

  if (action === "publish") {
    const [updated] = await db
      .update(editions)
      .set({
        copyrightStatus: "PUBLIC_DOMAIN_VERIFIED",

        publicationStatus: "PUBLISHED",

        verifiedAt: new Date(),

        copyrightNotes: notes ?? edition.copyrightNotes ?? "Public-domain status manually reviewed before publication.",

        updatedAt: new Date(),
      })
      .where(eq(editions.id, edition.id))
      .returning();

    console.log("Edition verified and published.");

    console.log(`Copyright: ${updated.copyrightStatus}`);

    console.log(`Publication: ${updated.publicationStatus}`);

    return;
  }

  if (action === "reject") {
    const [updated] = await db
      .update(editions)
      .set({
        copyrightStatus: "REJECTED",
        publicationStatus: "DRAFT",
        verifiedAt: null,

        copyrightNotes: notes ?? "Edition rejected during copyright review.",

        updatedAt: new Date(),
      })
      .where(eq(editions.id, edition.id))
      .returning();

    console.log("Edition rejected.");

    console.log(`Copyright: ${updated.copyrightStatus}`);

    return;
  }

  const [updated] = await db
    .update(editions)
    .set({
      publicationStatus: "ARCHIVED",
      updatedAt: new Date(),
    })
    .where(eq(editions.id, edition.id))
    .returning();

  console.log("Edition archived.");

  console.log(`Publication: ${updated.publicationStatus}`);
}

main()
  .catch((error) => {
    console.error("");
    console.error("Edition review failed");
    console.error(error);

    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
