import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { editions } from "./editions";

export const chapters = pgTable(
  "chapters",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    editionId: uuid("edition_id")
      .notNull()
      .references(() => editions.id, {
        onDelete: "cascade",
      }),

    number: integer("number").notNull(),

    slug: text("slug").notNull(),

    title: text("title").notNull(),

    content: text("content").notNull(),

    // Typed editorial blocks (src/lib/chapter-blocks.ts), validated with chapterBlocksForStorage before they are
    // written; `content` stays the plain text derived from them. NULL: a chapter imported before blocks existed,
    // which the reader shows from `content` as before. Typed `unknown`, not ChapterBlocks: a stored value is only
    // ChapterBlocks once readStoredChapterBlocks has validated it against `content`.
    blocks: jsonb("blocks").$type<unknown>(),

    wordCount: integer("word_count"),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("chapters_edition_idx").on(table.editionId),

    uniqueIndex("chapters_edition_slug_idx").on(table.editionId, table.slug),

    uniqueIndex("chapters_edition_number_idx").on(table.editionId, table.number),

    // Allows reading_progress to reference an exact
    // chapter within an exact edition.
    uniqueIndex("chapters_edition_id_idx").on(table.editionId, table.id),

    // The database checks the envelope only; the application validates the whole contract before writing.
    check(
      "chapters_blocks_envelope_check",
      sql`${table.blocks} IS NULL OR (jsonb_typeof(${table.blocks}) = 'object' AND ${table.blocks} -> 'version' = '1'::jsonb AND jsonb_typeof(${table.blocks} -> 'blocks') = 'array')`,
    ),
  ],
).enableRLS();
