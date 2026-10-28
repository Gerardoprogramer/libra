import { useTranslations } from "next-intl";

interface BookSynopsisProps {
  /** The one description the book page shows (the edition's, or else the work's published one), or null. */
  text: string | null;
  /** The language of the text: the edition's for its own description, the interface's for the work's. */
  lang: string;
}

// The synopsis on the book page, under its header's actions. It is editorial text about the book, never part of it:
// the reader and the chapters never show it. Without a description nothing is rendered, not even the heading.
export function BookSynopsis({ text, lang }: BookSynopsisProps) {
  const t = useTranslations("book");

  if (!text?.trim()) return null;

  return (
    <section aria-labelledby="book-synopsis" className="mt-10 max-w-2xl border-t pt-8">
      <h2 id="book-synopsis" className="font-serif text-2xl">
        {t("synopsis")}
      </h2>

      <p lang={lang} className="mt-4 text-base leading-7 text-pretty wrap-break-word md:leading-8">
        {text.trim()}
      </p>
    </section>
  );
}
