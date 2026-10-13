import { and, desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { books, chapters, editions, readingProgress } from "@/db/schema";
import { createClient } from "@/lib/supabase/server";
import { getPublicEditionVisibilityCondition } from "@/db/queries/editorial-visibility";
import { parseReadingProgressInput } from "@/lib/reading-progress-input";

export async function GET(request: Request) {
  const editionId = new URL(request.url).searchParams.get("edition");
  if (editionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(editionId)) {
    return NextResponse.json({ error: "Invalid edition." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
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
      .where(
        and(
          eq(readingProgress.userId, userId),
          editionId ? eq(readingProgress.editionId, editionId) : undefined,
          getPublicEditionVisibilityCondition(),
        ),
      )
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

export async function POST(request: Request) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return reply({ error: "Invalid origin." }, 403);
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return reply({ error: "Invalid content type." }, 415);
  }
  let input;
  try {
    const body = await request.text();
    if (body.length > 4096) return reply({ error: "Payload too large." }, 413);
    input = parseReadingProgressInput(JSON.parse(body));
  } catch {
    return reply({ error: "Invalid progress." }, 400);
  }
  if (!input) return reply({ error: "Invalid progress." }, 400);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || typeof data?.claims?.sub !== "string") return reply({ error: "Unauthorized." }, 401);
  if (data.claims.sub !== input.userId) return reply({ error: "Session changed." }, 403);

  try {
    const [chapter] = await db
      .select({ id: chapters.id })
      .from(chapters)
      .innerJoin(editions, eq(editions.id, chapters.editionId))
      .where(
        and(
          eq(chapters.id, input.chapterId),
          eq(chapters.editionId, input.editionId),
          getPublicEditionVisibilityCondition(),
        ),
      )
      .limit(1);
    if (!chapter) return reply({ error: "Chapter unavailable." }, 404);
    const updatedAt = new Date(input.updatedAt);
    const rows = await db
      .insert(readingProgress)
      .values({ ...input, updatedAt })
      .onConflictDoUpdate({
        target: [readingProgress.userId, readingProgress.editionId],
        set: {
          chapterId: input.chapterId,
          paragraphIndex: input.paragraphIndex,
          percentage: input.percentage,
          updatedAt,
        },
        // Atomic even when network responses arrive in reverse order.
        setWhere: sql`${readingProgress.updatedAt} <= ${updatedAt.toISOString()}::timestamptz`,
      })
      .returning({ id: readingProgress.id });
    return reply({ accepted: rows.length > 0 });
  } catch {
    return reply({ error: "Failed to save reading progress." }, 500);
  }
}
