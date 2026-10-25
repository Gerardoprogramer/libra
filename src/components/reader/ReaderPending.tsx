"use client";

import type { ComponentProps } from "react";

import { useReaderPreferences } from "@/hooks/useReaderPreferences";
import { useReaderThemeColor } from "@/lib/reader-theme-color";

// The chapter's loading placeholder (loading.tsx and the page's Suspense fallback). data-reader-pending hides the site
// header (globals.css), and its value, the stored reader theme, gives the placeholder and the document that theme's
// tokens, and the browser's bar its color (useReaderThemeColor). On a client navigation the stored theme is read when
// the placeholder mounts; a placeholder that comes in the server's HTML (a cold load) shows the default light theme,
// as the reader does until it hydrates.
export function ReaderPending(props: ComponentProps<"main">) {
  const { theme } = useReaderPreferences();
  useReaderThemeColor(theme);

  return <main id="main-content" data-reader-pending={theme} {...props} />;
}
