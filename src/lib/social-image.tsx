import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { cacheLife, cacheTag } from "next/cache";

import { SocialCard } from "@/components/seo/SocialCard";
import type { Locale } from "@/i18n/routing";
import { getAbsolutePublicImageUrl } from "@/lib/site-url";
import { socialImageSize } from "@/lib/social-metadata";

// Bundled with the function: generating a card never depends on a font CDN.
const serifFont = readFile(join(process.cwd(), "src/assets/fonts/LibreCaslonText-Regular.ttf"));

async function loadCover(value: string, slug: string): Promise<string | null> {
  "use cache";
  cacheLife("editorial");
  cacheTag("library:editorial", `book:${slug}`);

  const imageUrl = getAbsolutePublicImageUrl(value);
  const base = process.env.R2_PUBLIC_URL;
  if (!imageUrl || !base) return null;

  const url = new URL(imageUrl);
  const allowed = new URL(base);
  const prefix = `${allowed.pathname.replace(/\/$/, "")}/`;
  if (url.origin !== allowed.origin || !url.pathname.startsWith(prefix)) return null;

  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
    const type = response.headers.get("content-type")?.split(";")[0];
    if (!response.ok || !type || !["image/jpeg", "image/png", "image/webp"].includes(type)) return null;
    const maxBytes = 8 * 1024 * 1024;
    if (Number(response.headers.get("content-length")) > maxBytes || !response.body) return null;

    const chunks: Uint8Array[] = [];
    let length = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        length += chunk.byteLength;
        if (length > maxBytes) {
          await reader.cancel();
          return null;
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }
    return `data:${type};base64,${Buffer.concat(chunks).toString("base64")}`;
  } catch {
    // A missing or slow cover must still produce a useful, book-specific card.
    return null;
  }
}

export async function createSocialImage({
  locale,
  title,
  authors,
  coverUrl,
  slug,
}: {
  locale: Locale;
  title: string;
  authors?: string;
  coverUrl?: string | null;
  slug?: string;
}) {
  const cover = coverUrl && slug ? await loadCover(coverUrl, slug) : null;
  const font = await serifFont;
  const render = (source: string | null) =>
    new ImageResponse(
      <SocialCard locale={locale} title={title} authors={authors} cover={source} book={Boolean(slug)} />,
      { ...socialImageSize, fonts: [{ name: "Libra Serif", data: font, weight: 400, style: "normal" }] },
    ).arrayBuffer();

  let png: ArrayBuffer;
  try {
    // Consume the render here so a corrupt image can fall back before headers go out.
    png = await render(cover);
  } catch (error) {
    if (!cover) throw error;
    png = await render(null);
  }

  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
