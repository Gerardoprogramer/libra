import { useLocale, useTranslations } from "next-intl";

import type { BookDetails } from "@/db/queries/books";

interface EditionDetailsProps {
  edition: BookDetails["edition"];
  chapterCount: number;
}

function getLanguageName(language: string, locale: string) {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(language) ?? language;
  } catch {
    return language;
  }
}

function getSourceHref(sourceUrl: string | null) {
  if (!sourceUrl) return null;

  try {
    const url = new URL(sourceUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? sourceUrl : null;
  } catch {
    return null;
  }
}

export function EditionDetails({ edition, chapterCount }: EditionDetailsProps) {
  const t = useTranslations("book");
  const locale = useLocale();
  const sourceHref = getSourceHref(edition.sourceUrl);
  const identifier = edition.sourceIdentifier ? t("sourceIdentifier", { identifier: edition.sourceIdentifier }) : null;
  const sourceLabel = edition.sourceName ?? identifier ?? t("viewSource");

  return (
    <section aria-labelledby="edition-details" className="text-muted-foreground mt-6 border-l-2 pl-4 text-sm">
      <h2 id="edition-details" className="mb-2 text-xs tracking-[0.15em] uppercase">
        {t("editionDetails")}
      </h2>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-foreground">
          {t("editionLanguage", { language: getLanguageName(edition.language, locale) })}
        </span>
        {edition.publicationYear !== null && <span>{t("editionYear", { year: edition.publicationYear })}</span>}
        <span>{t("chapters", { count: chapterCount })}</span>
      </div>

      {edition.translator && <p className="mt-2">{t("translatedBy", { translator: edition.translator })}</p>}

      {(edition.sourceName || identifier || sourceHref) && (
        <p className="mt-2 wrap-break-word">
          {edition.sourceName && `${t("source")}: `}
          {sourceHref ? (
            <a
              href={sourceHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline decoration-current/30 underline-offset-4 transition hover:decoration-current"
            >
              {sourceLabel}
            </a>
          ) : (
            <span>{sourceLabel}</span>
          )}
          {edition.sourceName && identifier && (
            <>
              <span aria-hidden="true"> · </span>
              <span>{identifier}</span>
            </>
          )}
        </p>
      )}
    </section>
  );
}
