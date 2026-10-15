import type { Metadata, Viewport } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { Header } from "@/components/layout/Header";
import { routing } from "@/i18n/routing";
import { getConfiguredSiteUrl } from "@/lib/site-url";
import { getDefaultSocialImage } from "@/lib/social-metadata";

import "../globals.css";

// Keep existing blocking routes while adopting data caching incrementally.
export const instant = false;

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{
    locale: string;
  }>;
}

export const viewport: Viewport = { themeColor: "#ffffff" };

export async function generateMetadata({ params }: LocaleLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations({ locale, namespace: "home" });
  const title = t("metadataTitle");
  const description = t("metadataDescription");
  const images = getDefaultSocialImage(locale);

  // Canonical and language alternates belong to each page, never to the layout.
  return {
    metadataBase: getConfiguredSiteUrl(),
    title,
    description,
    applicationName: "Libra",
    authors: [{ name: "Libra" }],
    creator: "Libra",
    publisher: "Libra",
    generator: "Next.js",
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } },
    openGraph: {
      type: "website",
      title,
      description,
      siteName: "Libra",
      locale: locale === "es" ? "es_ES" : "en_US",
      images,
    },
    twitter: { card: "summary_large_image", title, description, images },
  };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({
    locale,
  }));
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const [messages, nav] = await Promise.all([getMessages(), getTranslations({ locale, namespace: "nav" })]);

  return (
    <html lang={locale}>
      <body>
        {/* Navigation needs the locale; only the error boundary needs global messages. */}
        <NextIntlClientProvider messages={{ errors: messages.errors, auth: messages.auth }}>
          <a
            href="#main-content"
            className="bg-background text-foreground ring-ring sr-only rounded-md px-4 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:ring-2"
          >
            {nav("skipToContent")}
          </a>
          <Header />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
