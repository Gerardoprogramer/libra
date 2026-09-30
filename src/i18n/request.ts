import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { locale as getRootLocale } from "next/root-params";

import en from "../../messages/en.json";
import es from "../../messages/es.json";

import { routing } from "./routing";

const messages = {
  en,
  es,
} as const;

export default getRequestConfig(async () => {
  const requested = await getRootLocale();

  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: messages[locale],
  };
});
