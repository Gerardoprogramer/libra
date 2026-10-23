import localFont from "next/font/local";

// Literata (variable weight), the default typeface of the chapter text ([data-reader-font] in globals.css). Imported
// only by the chapter route. It is not preloaded: links to a chapter prefetch that route, and a preload would make
// every page with such a link (the book page, Continue reading) download it. Without one, the browser fetches it only
// when chapter text is rendered.
export const readingFont = localFont({
  src: "../../assets/fonts/literata-latin-wght-normal.woff2",
  weight: "200 900",
  style: "normal",
  variable: "--font-literata",
  display: "swap",
  preload: false,
  adjustFontFallback: "Times New Roman",
});

// The typefaces the reader can choose instead of Literata (READER_FONTS in src/lib/reader-preferences.ts), loaded the
// same way. The chapter text holds no bold or italics, so the regular weight is enough. The chapter route sets the
// variables of all three on the article, but each file is fetched only once text is set in it: when that typeface is
// chosen.
export const merriweatherFont = localFont({
  src: "../../assets/fonts/merriweather-latin-400-normal.woff2",
  weight: "400",
  style: "normal",
  variable: "--font-merriweather",
  display: "swap",
  preload: false,
  adjustFontFallback: "Times New Roman",
});

export const lexendFont = localFont({
  src: "../../assets/fonts/lexend-latin-400-normal.woff2",
  weight: "400",
  style: "normal",
  variable: "--font-lexend",
  display: "swap",
  preload: false,
  adjustFontFallback: "Arial",
});

/** The classes that define the font variables of the chapter text, for the article that holds it. */
export const readingFontVariables = [readingFont.variable, merriweatherFont.variable, lexendFont.variable].join(" ");
