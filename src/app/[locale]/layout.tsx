import type { Metadata, Viewport } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { InlineScript } from "@/components/InlineScript";
import { ConnectionStatus } from "@/components/layout/ConnectionStatus";
import { Header } from "@/components/layout/Header";
import { ServiceWorkerRegistration } from "@/components/layout/ServiceWorkerRegistration";
import { routing } from "@/i18n/routing";
import { editorialFont } from "@/lib/fonts/editorial";
import { earlyReaderPreferencesScript } from "@/lib/reader-preferences";
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

// The sRGB value of --background in globals.css.
export const viewport: Viewport = { themeColor: "#fcfaf6" };

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
    // On the iOS home screen (standalone, from the manifest) the app is titled "Libra"; the default status bar
    // keeps dark text on the light paper, whereas "black-translucent" would draw it over the page's own bars.
    appleWebApp: { capable: true, title: "Libra", statusBarStyle: "default" },
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
  const [messages, nav, connection] = await Promise.all([
    getMessages(),
    getTranslations({ locale, namespace: "nav" }),
    getTranslations({ locale, namespace: "connection" }),
  ]);

  return (
    // suppressHydrationWarning: the early script may add its marks to <html> before React hydrates (it applies to this
    // element's own attributes only).
    <html lang={locale} className={editorialFont.variable} suppressHydrationWarning>
      <head>
        {/* Runs while the browser parses <head>, before the first paint: the stored reader preferences, which the
            server cannot read, are applied to the reader from the start (src/lib/reader-preferences.ts). A fixed
            script, the same in every page, so the layout stays static. A locale switch renders the layout again in
            the browser, where InlineScript renders nothing: the script runs once, from the server's HTML. */}
        <InlineScript html={earlyReaderPreferencesScript} />
      </head>
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
          {/* Labels are passed as props, so the client messages keep only the namespaces listed above. */}
          <ConnectionStatus offlineLabel={connection("offline")} restoredLabel={connection("restored")} />
          <ServiceWorkerRegistration />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
