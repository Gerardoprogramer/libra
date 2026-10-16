import { routing, type Locale } from "../i18n/routing";

/** Request header that next-intl's proxy sets to the locale it resolved from the URL. */
export const LOCALE_HEADER = "x-next-intl-locale";

/**
 * Locale of a 404 rendered outside any [locale] route. The proxy only sets the header for URLs it handles, so an
 * absent or unrecognized value (for example an unmatched /api/... path) uses the default locale; it is never guessed
 * from anything else.
 */
export function resolveNotFoundLocale(headerValue: string | null | undefined): Locale {
  return routing.locales.find((locale) => locale === headerValue) ?? routing.defaultLocale;
}
