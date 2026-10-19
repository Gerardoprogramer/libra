import localFont from "next/font/local";

// Libre Caslon Text for titles and headings (Tailwind's `font-serif`). Loaded by every layout that renders a page,
// including src/app/global-not-found.tsx, which does not go through the [locale] layout. Latin subset only: it
// covers Spanish and English. The TTF next to these files stays reserved for the social images.
export const editorialFont = localFont({
  src: [
    { path: "../../assets/fonts/libre-caslon-text-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../assets/fonts/libre-caslon-text-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-caslon",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});
