export interface SelectableEdition {
  language: string;
  slug: string;
  isPreferred: boolean;
  createdAt: Date;
}

function compareStable(first: SelectableEdition, second: SelectableEdition) {
  const createdAtDifference = first.createdAt.getTime() - second.createdAt.getTime();

  return createdAtDifference || (first.slug < second.slug ? -1 : first.slug > second.slug ? 1 : 0);
}

function selectLanguage<T extends SelectableEdition>(editions: readonly T[], language: string): T | undefined {
  const languageEditions = editions.filter((edition) => {
    const editionLanguage = edition.language.toLowerCase();

    return editionLanguage === language || editionLanguage.startsWith(`${language}-`);
  });

  return (
    languageEditions.find((edition) => edition.isPreferred) ??
    languageEditions.filter((edition) => edition.language === language).sort(compareStable)[0] ??
    languageEditions.sort(compareStable)[0]
  );
}

export function chooseEdition<T extends SelectableEdition>(editions: readonly T[], locale: "en" | "es"): T | undefined {
  return selectLanguage(editions, locale) ?? selectLanguage(editions, "en") ?? [...editions].sort(compareStable)[0];
}
