import localFont from "next/font/local";

// Literata (variable weight) for chapter text (`font-reading`). Imported only by the chapter route. It is not
// preloaded: links to a chapter prefetch that route, and a preload would make every page with such a link (the book
// page, Continue reading) download it. Without one, the browser fetches it only when chapter text is rendered.
export const readingFont = localFont({
  src: "../../assets/fonts/literata-latin-wght-normal.woff2",
  weight: "200 900",
  style: "normal",
  variable: "--font-literata",
  display: "swap",
  preload: false,
  adjustFontFallback: "Times New Roman",
});
