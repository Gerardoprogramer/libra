import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compileFunction } from "node:vm";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import { routing } from "../../i18n/routing";
import manifest from "../manifest";

// Stand in for the client components, so the layout's element tree can be searched for them.
function ConnectionStatus() {
  return null;
}

function ServiceWorkerRegistration() {
  return null;
}

// Every element in a rendered tree, depth first.
function* elements(node: unknown): Generator<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(node)) {
    for (const child of node) yield* elements(child);
  } else if (typeof node === "object" && node !== null && "props" in node) {
    const element = node as { type: unknown; props: Record<string, unknown> };
    yield element;
    yield* elements(element.props.children);
  }
}

// Loads layout.tsx with its dependencies replaced, so its metadata runs without the Next.js runtime.
function loadLayout() {
  const messages = { en, es } as const;
  const dependencies: Record<string, unknown> = {
    "react/jsx-runtime": jsxRuntime,
    "next-intl": {
      hasLocale: (locales: readonly string[], locale: string) => locales.includes(locale),
      NextIntlClientProvider: () => null,
    },
    "next-intl/server": {
      getTranslations:
        async ({ locale, namespace }: { locale: "en" | "es"; namespace: "home" }) =>
        (key: string) =>
          (messages[locale][namespace] as Record<string, string>)[key],
      getMessages: async () => ({}),
      setRequestLocale: () => {},
    },
    "next/navigation": {
      notFound: () => {
        throw new Error("notFound()");
      },
    },
    "@/components/InlineScript": {},
    "@/components/layout/ConnectionStatus": { ConnectionStatus },
    "@/components/layout/Header": {},
    "@/components/layout/ServiceWorkerRegistration": { ServiceWorkerRegistration },
    "@/i18n/routing": { routing },
    "@/lib/fonts/editorial": { editorialFont: { variable: "" } },
    "@/lib/reader-preferences": { earlyReaderPreferencesScript: "" },
    "@/lib/site-url": { getConfiguredSiteUrl: () => null },
    "@/lib/social-metadata": { getDefaultSocialImage: (locale: string) => [{ url: `/${locale}/opengraph-image` }] },
    "../globals.css": {},
  };
  const exports = {} as typeof import("./layout");
  compileFunction(
    ts.transpileModule(readFileSync(new URL("./layout.tsx", import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText,
    ["require", "exports"],
  )((name: string) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  }, exports);
  return exports;
}

test("on the iOS home screen, Libra is titled Libra and keeps the default status bar", async () => {
  for (const locale of routing.locales) {
    const metadata = await loadLayout().generateMetadata({ children: null, params: Promise.resolve({ locale }) });

    assert.deepEqual(metadata.appleWebApp, { capable: true, title: "Libra", statusBarStyle: "default" }, locale);
    assert.equal(metadata.applicationName, "Libra", locale);
  }
});

test("the app metadata leaves the existing SEO metadata of each locale as it was", async () => {
  for (const [locale, messages, ogLocale] of [
    ["es", es, "es_ES"],
    ["en", en, "en_US"],
  ] as const) {
    const metadata = await loadLayout().generateMetadata({ children: null, params: Promise.resolve({ locale }) });

    assert.equal(metadata.title, messages.home.metadataTitle);
    assert.equal(metadata.description, messages.home.metadataDescription);
    assert.deepEqual(metadata.robots, {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large" },
    });
    assert.equal(metadata.openGraph && "locale" in metadata.openGraph && metadata.openGraph.locale, ogLocale);
    // Canonical and language alternates belong to each page, never to the layout.
    assert.equal(metadata.alternates, undefined);
  }
});

test("an unknown locale is still a 404", async () => {
  await assert.rejects(
    loadLayout().generateMetadata({ children: null, params: Promise.resolve({ locale: "fr" }) }),
    /notFound/,
  );
});

test("every page carries the connection notice, worded in its locale", async () => {
  for (const [locale, messages] of [
    ["es", es],
    ["en", en],
  ] as const) {
    const tree = await loadLayout().default({ children: null, params: Promise.resolve({ locale }) });
    const notices = [...elements(tree)].filter((element) => element.type === ConnectionStatus);

    assert.equal(notices.length, 1, locale);
    assert.deepEqual(
      notices[0].props,
      { offlineLabel: messages.connection.offline, restoredLabel: messages.connection.restored },
      locale,
    );
  }
});

test("every page registers the offline fallback worker once", async () => {
  for (const locale of routing.locales) {
    const tree = await loadLayout().default({ children: null, params: Promise.resolve({ locale }) });
    const registrations = [...elements(tree)].filter((element) => element.type === ServiceWorkerRegistration);

    assert.equal(registrations.length, 1, locale);
  }
});

test("the browser theme color and the installed app's colors are the same paper", () => {
  const { viewport } = loadLayout();

  assert.equal(viewport.themeColor, manifest().theme_color);
  assert.equal(viewport.themeColor, manifest().background_color);
});
