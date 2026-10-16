import "./globals.css";

import type { Metadata } from "next";
import { headers } from "next/headers";

import en from "../../messages/en.json";
import es from "../../messages/es.json";
import { LOCALE_HEADER, resolveNotFoundLocale } from "../lib/not-found-locale";

// Any URL that matches no route is rendered here. The root layout lives under the dynamic [locale] segment, so
// Next.js has no layout to render it in and would answer with its own unlocalized error shell. This document is
// complete on its own (<html>, header and message) and keeps the real 404 status; Next.js adds noindex to it.
//
// Reading the request header makes the page render per request, which Next.js reports as a blocking prerender at
// build time unless the route opts out, the same way src/app/[locale]/layout.tsx does.
export const instant = false;

const messages = { en, es } as const;

async function getLocale() {
  return resolveNotFoundLocale((await headers()).get(LOCALE_HEADER));
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();

  return { title: `${messages[locale].errors.notFoundTitle} — Libra` };
}

export default async function GlobalNotFound() {
  const locale = await getLocale();
  const { errors, catalog } = messages[locale];

  return (
    <html lang={locale}>
      <body>
        <header className="bg-background border-b">
          <div className="mx-auto flex h-16 max-w-7xl items-center px-6">
            <a href={`/${locale}`} className="font-serif text-xl font-semibold tracking-tight">
              Libra
            </a>
          </div>
        </header>
        <main
          id="main-content"
          className="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center px-6 text-center"
        >
          <p className="text-muted-foreground text-sm">404</p>
          <h1 className="mt-3 font-serif text-4xl tracking-tight">{errors.notFoundTitle}</h1>
          <p className="text-muted-foreground mt-4 max-w-lg leading-7">{errors.notFoundDescription}</p>
          <a
            href={`/${locale}/books`}
            className="bg-primary text-primary-foreground hover:bg-primary/80 mt-7 inline-flex h-9 items-center rounded-full px-4 text-sm font-medium"
          >
            {catalog.title}
          </a>
        </main>
      </body>
    </html>
  );
}
