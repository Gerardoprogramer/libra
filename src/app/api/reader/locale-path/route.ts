import { NextResponse } from "next/server";

import { getLocalizedChapterPath, type ContentLocale } from "@/db/queries/books";
import { isSlug, isUuid } from "@/lib/catalog-filters";

function isContentLocale(value: string | null): value is ContentLocale {
  return value === "es" || value === "en";
}

// Anything that cannot name a stored book or chapter is refused before it can become its own cache entry.
const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const url = new URL(request.url);

  const book = url.searchParams.get("book");
  const chapter = url.searchParams.get("chapter");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const edition = url.searchParams.get("edition") ?? undefined;

  if (
    !isSlug(book) ||
    !isSlug(chapter) ||
    !isContentLocale(from) ||
    !isContentLocale(to) ||
    (edition !== undefined && !isUuid(edition))
  ) {
    return NextResponse.json({ error: "Invalid locale path request." }, { status: 400, headers: noStore });
  }

  const destination = await getLocalizedChapterPath(book, chapter, from, to, edition);

  if (!destination) {
    return NextResponse.json({ error: "Localized chapter not found." }, { status: 404, headers: noStore });
  }

  return NextResponse.json(destination, { headers: noStore });
}
