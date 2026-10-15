import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { copyrightStatusEnum, editions, publicationStatusEnum } from "./editions";

export const editionReviewActionEnum = pgEnum("edition_review_action", ["PUBLISH", "REJECT", "ARCHIVE", "PREFER"]);

/**
 * Append-only trail of editorial decisions on an edition (who, when, from which state to which, on what
 * grounds). Written by `pnpm db:review` in the same transaction as the status change, so a decision without
 * its record cannot be committed. Row level security is enabled with no policy: only the server's own
 * database role can read or write it.
 */
export const editionReviews = pgTable(
  "edition_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    editionId: uuid("edition_id")
      .notNull()
      .references(() => editions.id, {
        onDelete: "cascade",
      }),

    action: editionReviewActionEnum("action").notNull(),

    previousPublicationStatus: publicationStatusEnum("previous_publication_status").notNull(),

    newPublicationStatus: publicationStatusEnum("new_publication_status").notNull(),

    previousCopyrightStatus: copyrightStatusEnum("previous_copyright_status").notNull(),

    newCopyrightStatus: copyrightStatusEnum("new_copyright_status").notNull(),

    /** The grounds of the decision, e.g. the author's death year and the jurisdiction relied on. */
    notes: text("notes"),

    /** Size of the edition when the decision was taken. */
    chapterCount: integer("chapter_count").notNull(),

    wordCount: integer("word_count").notNull(),

    /** Operating-system user that ran the review script. */
    reviewer: text("reviewer").notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("edition_reviews_edition_idx").on(table.editionId, table.createdAt)],
).enableRLS();
