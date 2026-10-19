"use client";

import { createContext, useContext } from "react";

import type { ReaderTheme } from "@/lib/reader-preferences";

// The menus and the chapter index opened from the reader's bar are portaled to <body>, outside the reading surface.
// They carry the reader's theme themselves (globals.css, [data-reader-panel-theme]) instead of looking for a reader in
// the page: after a client navigation React keeps the readers of earlier chapters hidden in the DOM, each with the
// theme it last rendered.
const ReaderPanelThemeContext = createContext<ReaderTheme | undefined>(undefined);

export const ReaderPanelThemeProvider = ReaderPanelThemeContext.Provider;

/** Props for a panel's portaled content: the reader's theme, or none outside a reader. */
export function readerPanelThemeProps(theme: ReaderTheme | undefined): { "data-reader-panel-theme"?: ReaderTheme } {
  return theme ? { "data-reader-panel-theme": theme } : {};
}

/** readerPanelThemeProps for a panel rendered somewhere inside a reader, such as the language menu in its bar. */
export function useReaderPanelThemeProps() {
  return readerPanelThemeProps(useContext(ReaderPanelThemeContext));
}
