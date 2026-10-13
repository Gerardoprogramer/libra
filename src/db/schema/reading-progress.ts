import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUsers } from "drizzle-orm/supabase";

import { chapters } from "./chapters";

export const readingProgress = pgTable(
  "reading_progress",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id").notNull(),

    editionId: uuid("edition_id").notNull(),

    chapterId: uuid("chapter_id").notNull(),

    /**
     * Zero-based paragraph currently being read.
     */
    paragraphIndex: integer("paragraph_index").notNull().default(0),

    /**
     * Percentage read inside the current chapter.
     * 0 - 100
     */
    percentage: integer("percentage").notNull().default(0),

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
    foreignKey({
      columns: [table.userId],
      foreignColumns: [authUsers.id],
      name: "reading_progress_user_id_auth_users_id_fk",
    }).onDelete("cascade"),

    /**
     * Guarantees that the chapter belongs to the
     * edition stored in the same reading-progress row.
     */
    foreignKey({
      columns: [table.editionId, table.chapterId],
      foreignColumns: [chapters.editionId, chapters.id],
      name: "reading_progress_edition_chapter_fk",
    }).onDelete("cascade"),

    /**
     * One current reading position per user and edition.
     */
    uniqueIndex("reading_progress_user_edition_idx").on(table.userId, table.editionId),

    /**
     * Supports "recently read" queries.
     */
    index("reading_progress_user_updated_idx").on(table.userId, table.updatedAt),

    check("reading_progress_paragraph_index_check", sql`${table.paragraphIndex} >= 0`),

    check("reading_progress_percentage_check", sql`${table.percentage} >= 0 AND ${table.percentage} <= 100`),

    pgPolicy("reading_progress_select_own", {
      for: "select",
      to: authenticatedRole,
      using: sql`(select auth.uid()) = ${table.userId}`,
    }),

    pgPolicy("reading_progress_insert_own", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`(select auth.uid()) = ${table.userId}`,
    }),

    pgPolicy("reading_progress_update_own", {
      for: "update",
      to: authenticatedRole,
      using: sql`(select auth.uid()) = ${table.userId}`,
      withCheck: sql`(select auth.uid()) = ${table.userId}`,
    }),

    pgPolicy("reading_progress_delete_own", {
      for: "delete",
      to: authenticatedRole,
      using: sql`(select auth.uid()) = ${table.userId}`,
    }),
  ],
).enableRLS();
