import { timingSafeEqual } from "node:crypto";

import { revalidateTag } from "next/cache";

import { parseEditorialCacheTags } from "@/lib/editorial-cache-tags";

export async function POST(request: Request) {
  const secret = process.env.CACHE_REVALIDATION_SECRET;
  const headers = { "Cache-Control": "no-store" };

  if (!secret) {
    return Response.json({ error: "Cache invalidation is not configured." }, { status: 503, headers });
  }

  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");

  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return Response.json({ error: "Unauthorized." }, { status: 401, headers });
  }

  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return Response.json({ error: "Expected application/json." }, { status: 415, headers });
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400, headers });
  }

  const tags = parseEditorialCacheTags(payload);

  if (!tags) {
    return Response.json(
      { error: "Expected 1–50 valid editorial tags, at most 256 characters each." },
      { status: 400, headers },
    );
  }

  for (const tag of tags) {
    // External scripts need expiration, not stale-while-revalidate.
    revalidateTag(tag, { expire: 0 });
  }

  return Response.json({ revalidated: true, tags }, { headers });
}
