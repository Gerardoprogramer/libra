import { useTranslations } from "next-intl";

interface WorkDescriptionProps {
  /** The work's published description in the interface language (getWorkDescription), or null. */
  description: string | null;
  /** The language of the description: the interface's, not the edition's. */
  lang: string;
}

// "About this work", between the book's header and its chapters. Without a published description nothing is rendered,
// not even the heading.
export function WorkDescription({ description, lang }: WorkDescriptionProps) {
  const t = useTranslations("book");

  if (!description) return null;

  return (
    <section aria-labelledby="about-this-work" className="mx-auto max-w-4xl px-6 pt-14">
      <h2 id="about-this-work" className="font-serif text-3xl">
        {t("aboutThisWork")}
      </h2>

      <p lang={lang} className="mt-5 max-w-prose text-base leading-8">
        {description}
      </p>
    </section>
  );
}
