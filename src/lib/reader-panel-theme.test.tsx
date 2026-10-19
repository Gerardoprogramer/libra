import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { readerPanelThemeProps, ReaderPanelThemeProvider, useReaderPanelThemeProps } from "./reader-panel-theme";

function Panel() {
  return <div {...useReaderPanelThemeProps()} />;
}

test("a panel inside a reader carries the reader's theme, and none outside it", () => {
  for (const theme of ["light", "sepia", "dark"] as const) {
    assert.deepEqual(readerPanelThemeProps(theme), { "data-reader-panel-theme": theme });
    assert.equal(
      renderToStaticMarkup(
        <ReaderPanelThemeProvider value={theme}>
          <Panel />
        </ReaderPanelThemeProvider>,
      ),
      `<div data-reader-panel-theme="${theme}"></div>`,
    );
  }

  assert.deepEqual(readerPanelThemeProps(undefined), {});
  assert.equal(renderToStaticMarkup(<Panel />), "<div></div>");
});

test("the reader passes its theme to the settings panel, the chapter index and the language menu", () => {
  const reader = readFileSync(new URL("../components/reader/ReaderView.tsx", import.meta.url), "utf8");
  const languageMenu = readFileSync(new URL("../components/layout/LanguageMenu.tsx", import.meta.url), "utf8");

  for (const panel of ["<SheetContent", "<PopoverContent"]) {
    assert.match(reader, new RegExp(`${panel}\\s+\\{\\.\\.\\.readerPanelThemeProps\\(theme\\)\\}`), panel);
  }
  assert.match(reader, /<ReaderPanelThemeProvider value=\{theme\}>\s*<div[^>]*>\{languageSwitcher\}/);
  assert.match(languageMenu, /<DropdownMenuContent\s+\{\.\.\.panelThemeProps\}/);
});

test("panel themes come from the panel's own attribute, never from whichever reader is in the page", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  // React keeps the readers of earlier chapters hidden in the DOM, each with its last theme: a selector that looks for
  // any reader would give the panels a hidden reader's theme.
  assert.doesNotMatch(css, /body:has\(\[data-reader-theme[^)]*\)\)?\s*(\[data-radix-popper-content-wrapper\]|:is\()/);
  assert.match(css, /\[data-reader-panel-theme="sepia"\]\s*\{/);
  assert.match(css, /\[data-reader-panel-theme="dark"\]\s*\{/);
});
