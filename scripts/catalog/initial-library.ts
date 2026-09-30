import type { CatalogEntry } from "../lib/import-collection";

// Paths are relative to the project root. EPUBs are supplied manually.
// Importing an edition does not publish it or assign categories.
export const initialLibrary = [
  {
    file: "imports/dracula.epub",
    gutenbergId: 345,
    slug: "dracula",
    year: 1897,
  },
  {
    file: "imports/frankenstein.epub",
    gutenbergId: 84,
    slug: "frankenstein",
    year: 1818,
  },
] satisfies CatalogEntry[];
