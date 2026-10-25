"use client";

import { useEffect } from "react";

import { READER_DARK_THEME_COLOR, READER_THEME_COLOR_ATTRIBUTE, type ReaderTheme } from "@/lib/reader-preferences";

// The readers and chapter placeholders whose effects are running, in the order they started. Each has one entry; the
// last one decides the bar's color. A page React keeps hidden after a client navigation has its effects cleaned up, so
// only what is shown takes part, and when two overlap during a navigation the one that arrived last wins.
const claims: { theme: ReaderTheme }[] = [];

// Sets or removes the reader's <meta name="theme-color"> for the latest claim, writing only what changed.
function applyReaderThemeColor(doc: Document) {
  const meta = doc.head.querySelector(`meta[${READER_THEME_COLOR_ATTRIBUTE}]`);

  if (claims.at(-1)?.theme !== "dark") {
    meta?.remove();
    return;
  }

  const element = meta ?? doc.createElement("meta");
  if (!meta) {
    element.setAttribute("name", "theme-color");
    element.setAttribute(READER_THEME_COLOR_ATTRIBUTE, "");
  }
  if (element.getAttribute("content") !== READER_DARK_THEME_COLOR) {
    element.setAttribute("content", READER_DARK_THEME_COLOR);
  }
  // The browser takes the first theme-color meta: this one goes before the site's (viewport.themeColor).
  if (doc.head.firstElementChild !== element) doc.head.prepend(element);
}

/**
 * Gives the browser's bar the dark reader's background while a reader (or placeholder) with that theme is shown, until
 * the returned function releases it: the site's color is back once no shown reader is dark.
 */
export function claimReaderThemeColor(theme: ReaderTheme, doc: Document = document) {
  const claim = { theme };
  claims.push(claim);
  applyReaderThemeColor(doc);

  return () => {
    const index = claims.indexOf(claim);
    if (index === -1) return;
    claims.splice(index, 1);
    applyReaderThemeColor(doc);
  };
}

/** claimReaderThemeColor for as long as the component is shown with this theme. */
export function useReaderThemeColor(theme: ReaderTheme) {
  useEffect(() => claimReaderThemeColor(theme), [theme]);
}
