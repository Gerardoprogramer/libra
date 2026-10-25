import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import { READER_DARK_THEME_COLOR, READER_PREFERENCES_STORAGE_KEY } from "./reader-preferences";
import { claimReaderThemeColor } from "./reader-theme-color";

// A <head> with the parts of the DOM claimReaderThemeColor uses, which counts its writes.
function createDocument() {
  const children: FakeElement[] = [];
  const writes: string[] = [];

  class FakeElement {
    attributes = new Map<string, string>();
    getAttribute(name: string) {
      return this.attributes.get(name) ?? null;
    }
    setAttribute(name: string, value: string) {
      writes.push(`${name}=${value}`);
      this.attributes.set(name, value);
    }
    remove() {
      const index = children.indexOf(this);
      if (index !== -1) children.splice(index, 1);
    }
  }

  const head = {
    get firstElementChild() {
      return children[0] ?? null;
    },
    prepend(element: FakeElement) {
      writes.push("prepend");
      element.remove();
      children.unshift(element);
    },
    querySelector(selector: string) {
      const attribute = /^meta\[([\w-]+)\]$/.exec(selector)?.[1];
      assert.ok(attribute, selector);
      return children.find((element) => element.attributes.has(attribute)) ?? null;
    },
  };
  const site = new FakeElement();
  site.attributes.set("name", "theme-color");
  site.attributes.set("content", "#fcfaf6");
  children.push(site);

  const doc = { head, createElement: () => new FakeElement() } as unknown as Document;
  // The color the browser shows: the first theme-color meta's.
  const barColor = () =>
    children.find((element) => element.getAttribute("name") === "theme-color")?.getAttribute("content");

  return { doc, children, writes, site, barColor };
}

test("a dark reader gives the bar its background, before the site's color, and gives the site's color back", () => {
  const { doc, children, site, barColor } = createDocument();

  const release = claimReaderThemeColor("dark", doc);
  assert.equal(barColor(), READER_DARK_THEME_COLOR);
  assert.equal(children.length, 2);
  assert.equal(children[1], site);

  release();
  assert.equal(barColor(), "#fcfaf6");
  assert.deepEqual(children, [site]);
  // Released twice: nothing more happens.
  release();
  assert.deepEqual(children, [site]);
});

test("light and sepia readers keep the site's color", () => {
  for (const theme of ["light", "sepia"] as const) {
    const { doc, children, site, barColor, writes } = createDocument();
    const release = claimReaderThemeColor(theme, doc);

    assert.equal(barColor(), "#fcfaf6");
    assert.deepEqual(children, [site]);
    assert.deepEqual(writes, []);
    release();
  }
});

test("a theme change in the reader swaps the bar's color, and a repeated dark claim writes nothing new", () => {
  const { doc, children, site, barColor, writes } = createDocument();

  // useReaderThemeColor releases the old theme's claim and makes the new one, as React runs the effect again.
  let release = claimReaderThemeColor("light", doc);
  release();
  release = claimReaderThemeColor("dark", doc);
  assert.equal(barColor(), READER_DARK_THEME_COLOR);
  release();
  release = claimReaderThemeColor("sepia", doc);
  assert.equal(barColor(), "#fcfaf6");
  release();

  const first = claimReaderThemeColor("dark", doc);
  const written = writes.length;
  // A placeholder and the reader that replaces it, both dark: one meta, no second write.
  const second = claimReaderThemeColor("dark", doc);
  assert.equal(writes.length, written);
  first();
  assert.equal(writes.length, written);
  assert.equal(barColor(), READER_DARK_THEME_COLOR);
  assert.equal(children.length, 2);
  second();
  assert.deepEqual(children, [site]);
});

test("when readers overlap, the one shown last decides, whatever order the others leave in", () => {
  const { doc, barColor, children, site } = createDocument();

  // A dark chapter, then a client navigation to a page whose placeholder is light (another tab changed the theme):
  // the new one arrives before the old one's effects are cleaned up.
  const dark = claimReaderThemeColor("dark", doc);
  const light = claimReaderThemeColor("light", doc);
  assert.equal(barColor(), "#fcfaf6");
  dark();
  assert.equal(barColor(), "#fcfaf6");

  // Back: the dark reader React kept hidden is shown again before the light one is hidden.
  const shownAgain = claimReaderThemeColor("dark", doc);
  assert.equal(barColor(), READER_DARK_THEME_COLOR);
  light();
  assert.equal(barColor(), READER_DARK_THEME_COLOR);

  // Leaving the reader for any other page.
  shownAgain();
  assert.equal(barColor(), "#fcfaf6");
  assert.deepEqual(children, [site]);
});

test("the reader's meta stays first even if something is added before it", () => {
  const { doc, children, barColor } = createDocument();
  const release = claimReaderThemeColor("dark", doc);
  const other = doc.createElement("meta");
  other.setAttribute("name", "theme-color");
  other.setAttribute("content", "#ffffff");
  doc.head.prepend(other);

  // The next claim (a chapter change) puts it back in front.
  const next = claimReaderThemeColor("dark", doc);
  assert.equal(barColor(), READER_DARK_THEME_COLOR);
  release();
  next();
  assert.equal(children.length, 2);
});

// Contrast (WCAG 2.2) of the dark theme's tokens, as globals.css sets them.

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function themeTokens(selector: string) {
  const block = css.slice(css.indexOf(selector));
  const body = block.slice(block.indexOf("{") + 1, block.indexOf("}"));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value]));
}

function rgb(hex: string) {
  assert.match(hex, /^#[0-9a-f]{6}$/, hex);
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
}

function luminance(color: number[]) {
  const [r, g, b] = color.map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: number[], b: number[]) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

// A color drawn at an opacity over a background, as the browser composites it.
function over(color: number[], opacity: number, background: number[]) {
  return color.map((value, index) => value * opacity + background[index] * (1 - opacity));
}

const dark = themeTokens('[data-reader-panel-theme="dark"] {');
const token = (name: string) => rgb(dark[`--${name}`]);

test("the dark theme is the near-black OLED page the bar takes, with warm grey text rather than white", () => {
  assert.equal(dark["--background"], READER_DARK_THEME_COLOR);
  assert.notEqual(dark["--foreground"], "#ffffff");
  assert.ok(luminance(token("foreground")) < 0.8, dark["--foreground"]);
  assert.match(css.slice(css.indexOf('[data-reader-panel-theme="dark"] {')), /^[^}]*color-scheme: dark;/);
  // The tokens a component may take from shadcn/ui are all set, so none falls back to the light paper of :root.
  for (const name of ["card", "secondary", "sidebar", "sidebar-primary", "sidebar-accent", "sidebar-border"]) {
    assert.ok(dark[`--${name}`], name);
  }
});

test("every text pair of the dark theme meets 4.5:1", () => {
  const surfaces = ["background", "card", "popover", "secondary", "muted", "accent"];
  const pairs: [string, string][] = [
    ...surfaces.map((surface) => ["foreground", surface] as [string, string]),
    ...surfaces.map((surface) => ["muted-foreground", surface] as [string, string]),
    ["card-foreground", "card"],
    ["popover-foreground", "popover"],
    ["secondary-foreground", "secondary"],
    ["accent-foreground", "accent"],
    // text-primary on the chapter links, at rest and hovered (bg-muted), and in the panels.
    ["primary", "background"],
    ["primary", "muted"],
    ["primary", "popover"],
    ["primary-foreground", "primary"],
    ["destructive", "background"],
    ["destructive", "popover"],
    ["sidebar-foreground", "sidebar"],
    ["sidebar-accent-foreground", "sidebar-accent"],
    ["sidebar-primary-foreground", "sidebar-primary"],
  ];

  for (const [text, surface] of pairs) {
    const ratio = contrast(token(text), token(surface));
    assert.ok(ratio >= 4.5, `${text} on ${surface}: ${ratio.toFixed(2)}`);
  }
});

test("the focus ring, drawn at 50%, and the selected outline meet 3:1 next to the page and the panels", () => {
  // focus-visible:ring-ring/50 (ReaderView, button) draws the ring outside the control, over what surrounds it.
  for (const surface of ["background", "popover", "card"]) {
    const ring = contrast(over(token("ring"), 0.5, token(surface)), token(surface));
    assert.ok(ring >= 3, `ring/50 on ${surface}: ${ring.toFixed(2)}`);
    // aria-pressed:ring-primary and border-primary mark the chosen option and the next chapter.
    const selected = contrast(token("primary"), token(surface));
    assert.ok(selected >= 3, `primary on ${surface}: ${selected.toFixed(2)}`);
  }
  assert.ok(contrast(over(rgb(dark["--sidebar-ring"]), 0.5, token("sidebar")), token("sidebar")) >= 3);
});

// The offline pages (public/offline-*.html), which take the reader's dark theme from the stored preferences.

for (const locale of ["es", "en"]) {
  const page = readFileSync(new URL(`../../public/offline-${locale}.html`, import.meta.url), "utf8");
  const script = /<script>([\s\S]*?)<\/script>/.exec(page)![1];

  // Runs the page's script as the browser does, before the first paint, against a stored value or blocked storage.
  function runOfflineScript(stored: string | null | { blocked: true }) {
    const attributes = new Map<string, string>();
    const meta = new Map([["content", "#fcfaf6"]]);
    runInNewContext(script, {
      localStorage: {
        getItem(key: string) {
          if (stored !== null && typeof stored === "object") throw new Error("Storage access denied");
          return key === READER_PREFERENCES_STORAGE_KEY ? stored : null;
        },
      },
      document: {
        documentElement: { setAttribute: (name: string, value: string) => attributes.set(name, value) },
        querySelector: (selector: string) => {
          assert.equal(selector, 'meta[name="theme-color"]');
          return { setAttribute: (name: string, value: string) => meta.set(name, value) };
        },
      },
    });
    return { theme: attributes.get("data-theme") ?? null, barColor: meta.get("content") };
  }

  test(`the ${locale} offline page takes the stored dark theme before its first paint, and stays light otherwise`, () => {
    assert.deepEqual(runOfflineScript(JSON.stringify({ theme: "dark", width: "wide", fontSize: 22 })), {
      theme: "dark",
      barColor: READER_DARK_THEME_COLOR,
    });
    for (const stored of [
      null,
      "",
      "{",
      "null",
      '"dark"',
      JSON.stringify({ theme: "light" }),
      JSON.stringify({ theme: "sepia" }),
      JSON.stringify({ theme: "DARK" }),
      JSON.stringify({ theme: ["dark"] }),
      { blocked: true } as const,
    ]) {
      assert.deepEqual(runOfflineScript(stored), { theme: null, barColor: "#fcfaf6" }, JSON.stringify(stored));
    }

    // In <head>, before the styles, so the page is never painted light first; nothing comes from the network.
    assert.ok(page.indexOf("<script>") < page.indexOf("<style>"));
    assert.ok(page.indexOf('<meta name="theme-color"') < page.indexOf("<script>"));
    assert.doesNotMatch(page, /\bsrc=|url\(|@import|<link\b|https?:\/\//);
  });

  test(`the ${locale} offline page's dark colors are the reader's, with readable text and controls`, () => {
    const rule = (selector: string) =>
      new RegExp(`${selector.replace(/[[\]().]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(page)?.[1] ?? "";
    const color = (selector: string, property: string) =>
      new RegExp(`(?:^|[\\s;])${property}:\\s*(#[0-9a-f]{6})`).exec(rule(selector))?.[1] ?? "";

    const background = color(':root[data-theme="dark"] body', "background");
    assert.equal(background, dark["--background"]);
    assert.equal(color(':root[data-theme="dark"] body', "color"), dark["--foreground"]);
    assert.match(rule(':root[data-theme="dark"]'), /color-scheme: dark;/);

    const page_ = rgb(background);
    for (const [selector, property, minimum] of [
      [':root[data-theme="dark"] body', "color", 4.5],
      [':root[data-theme="dark"] p', "color", 4.5],
      [':root[data-theme="dark"] .brand', "color", 4.5],
      // The button against the page, and its focus outline.
      [':root[data-theme="dark"] a', "background", 3],
      [':root[data-theme="dark"] a:focus-visible', "outline-color", 3],
    ] as const) {
      const value = color(selector, property);
      assert.ok(contrast(rgb(value), page_) >= minimum, `${selector} ${property} ${value}`);
    }
    const button = rgb(color(':root[data-theme="dark"] a', "background"));
    assert.ok(contrast(rgb(color(':root[data-theme="dark"] a', "color")), button) >= 4.5);
  });
}
