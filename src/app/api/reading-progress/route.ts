import { and, desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { books, chapters, editions, readingProgress } from "@/db/schema";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();

  const { data, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError) {
    const response = NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  const userId = data?.claims?.sub;

  if (typeof userId !== "string") {
    const response = NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  try {
    const rows = await db
      .select({
        id: readingProgress.id,
        userId: readingProgress.userId,
        editionId: readingProgress.editionId,
        chapterId: readingProgress.chapterId,
        paragraphIndex: readingProgress.paragraphIndex,
        percentage: readingProgress.percentage,
        createdAt: readingProgress.createdAt,
        updatedAt: readingProgress.updatedAt,

        bookSlug: books.slug,

        chapterSlug: chapters.slug,
        chapterTitle: chapters.title,
        chapterNumber: chapters.number,

        contentLanguage: editions.language,

        chapterIndex: sql<number>`(
          SELECT count(*)::int
          FROM chapters AS previous_chapter
          WHERE previous_chapter.edition_id = ${chapters.editionId}
            AND previous_chapter.number < ${chapters.number}
        )`,

        totalChapters: sql<number>`(
          SELECT count(*)::int
          FROM chapters AS edition_chapter
          WHERE edition_chapter.edition_id = ${chapters.editionId}
        )`,
      })
      .from(readingProgress)
      .innerJoin(editions, eq(readingProgress.editionId, editions.id))
      .innerJoin(books, eq(editions.bookId, books.id))
      .innerJoin(
        chapters,
        and(eq(readingProgress.chapterId, chapters.id), eq(readingProgress.editionId, chapters.editionId)),
      )
      .where(eq(readingProgress.userId, userId))
      .orderBy(desc(readingProgress.updatedAt))
      .limit(50);

    const response = NextResponse.json({
      progress: rows,
    });

    response.headers.set("Cache-Control", "no-store");

    return response;
  } catch {
    const response = NextResponse.json({ error: "Failed to retrieve reading progress." }, { status: 500 });

    response.headers.set("Cache-Control", "no-store");

    return response;
  }
}
