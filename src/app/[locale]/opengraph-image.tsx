import { hasLocale } from "next-intl";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import { routing } from "@/i18n/routing";
import { createSocialImage } from "@/lib/social-image";

export const alt = "Libra";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function SiteImage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return new Response(null, { status: 404 });
  // Route Handlers cannot read next/root-params, used by the page i18n config.
  const home = (locale === "es" ? es : en).home;
  return createSocialImage({ locale, title: `${home.titleFirst} ${home.titleSecond}` });
}
