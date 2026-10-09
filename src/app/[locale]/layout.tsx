import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { Header } from "@/components/layout/Header";
import { routing } from "@/i18n/routing";

import "../globals.css";

// Keep existing blocking routes while adopting data caching incrementally.
export const instant = false;

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{
    locale: string;
  }>;
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
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body>
        {/* Navigation needs the locale; only the error boundary needs global messages. */}
        <NextIntlClientProvider messages={{ errors: messages.errors }}>
          <Header />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
