import { NextResponse } from "next/server";

import { getLocalizedChapterPath, type ContentLocale } from "@/db/queries/books";

function isContentLocale(value: string | null): value is ContentLocale {
  return value === "es" || value === "en";
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  const book = url.searchParams.get("book");
  const chapter = url.searchParams.get("chapter");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  if (!book || !chapter || !isContentLocale(from) || !isContentLocale(to)) {
    return NextResponse.json(
      { error: "Invalid locale path request." },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const pathname = await getLocalizedChapterPath(book, chapter, from, to);

  if (!pathname) {
    return NextResponse.json(
      { error: "Localized chapter not found." },
      {
        status: 404,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return NextResponse.json(
    { pathname },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
