import { useTranslations } from "next-intl";

import { SynopsisText } from "./SynopsisText";

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
    <section aria-labelledby="book-synopsis" className="mt-10 max-w-[65ch] border-t pt-8 md:mt-12">
      <h2 id="book-synopsis" className="section-title">
        {t("synopsis")}
      </h2>

      <SynopsisText text={text.trim()} lang={lang} moreLabel={t("readMore")} lessLabel={t("readLess")} />
    </section>
  );
}
