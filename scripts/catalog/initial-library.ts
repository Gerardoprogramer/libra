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
  {
    file: "imports/pride-and-prejudice.epub",
    gutenbergId: 1342,
    slug: "pride-and-prejudice",
    year: 1813,
  },
  {
    file: "imports/the-picture-of-dorian-gray.epub",
    gutenbergId: 174,
    slug: "the-picture-of-dorian-gray",
    year: 1890,
  },
  {
    file: "imports/jekyll-and-hyde.epub",
    gutenbergId: 43,
    slug: "jekyll-and-hyde",
    year: 1886,
  },
  {
    file: "imports/alice-in-wonderland.epub",
    gutenbergId: 11,
    slug: "alice-in-wonderland",
    year: 1865,
  },
  {
    file: "imports/adventures-of-sherlock-holmes.epub",
    gutenbergId: 48320,
    slug: "adventures-of-sherlock-holmes",
    year: 1892,
  },
  {
    file: "imports/the-time-machine.epub",
    gutenbergId: 35,
    slug: "the-time-machine",
    year: 1895,
  },
  {
    file: "imports/the-war-of-the-worlds.epub",
    gutenbergId: 36,
    slug: "the-war-of-the-worlds",
    year: 1898,
  },
  {
    file: "imports/moby-dick.epub",
    gutenbergId: 15,
    slug: "moby-dick",
    year: 1851,
  },
  {
    file: "imports/a-christmas-carol.epub",
    gutenbergId: 46,
    slug: "a-christmas-carol",
    year: 1843,
  },
  {
    file: "imports/the-wonderful-wizard-of-oz.epub",
    gutenbergId: 43936,
    slug: "the-wonderful-wizard-of-oz",
    year: 1900,
  },
] satisfies CatalogEntry[];
