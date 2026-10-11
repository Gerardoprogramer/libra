import { hasLocale } from "next-intl";
import { getBookBySlug } from "@/db/queries/books";
import { routing } from "@/i18n/routing";
import { createSocialImage } from "@/lib/social-image";

export const alt = "Libra — Book cover, title and author";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function BookImage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) return new Response(null, { status: 404 });

  const book = await getBookBySlug(slug, locale);
  if (!book) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

  return createSocialImage({
    locale,
    slug: book.slug,
    title: book.edition.title,
    authors: book.authors.map((author) => author.name).join(", "),
    coverUrl: book.edition.coverUrl,
  });
}
