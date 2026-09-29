export interface Chapter {
  slug: string;
  number: number;
  title: string;
  content: string[];
}

export interface Book {
  id: string;
  slug: string;
  title: string;
  author: string;
  year: number;
  category: string;
  rating: number;
  cover: string;
  description: string;
  language: string;
  chapters: Chapter[];
}

export const books: Book[] = [
  {
    id: "1",
    slug: "frankenstein",
    title: "Frankenstein",
    author: "Mary Shelley",
    year: 1818,
    category: "Gothic Horror",
    rating: 4.7,
    cover: "from-slate-800 to-emerald-950",
    description:
      "A young scientist creates life through an unorthodox experiment, only to face the consequences of bringing his creation into the world.",
    language: "English",
    chapters: [
      {
        slug: "chapter-1",
        number: 1,
        title: "Chapter I",
        content: [
          "This is temporary reading content while we build the reader and prepare the real public-domain editions.",
          "For now, our objective is to validate typography, spacing, navigation and the overall reading experience.",
          "Later, this content will come directly from PostgreSQL and verified public-domain editions.",
          "A good reading interface should almost disappear. The text should be the protagonist, with controls available when the reader needs them but never competing for attention.",
        ],
      },
      {
        slug: "chapter-2",
        number: 2,
        title: "Chapter II",
        content: [
          "This is the second temporary chapter.",
          "We will eventually parse complete editions automatically and store their chapters independently.",
          "That will allow search engines to index book pages while keeping the reading experience fast and organized.",
        ],
      },
    ],
  },
  {
    id: "2",
    slug: "dracula",
    title: "Dracula",
    author: "Bram Stoker",
    year: 1897,
    category: "Gothic Horror",
    rating: 4.6,
    cover: "from-red-950 to-zinc-950",
    description:
      "Bram Stoker's gothic novel follows the mysterious Count Dracula and those who discover the terrifying truth surrounding him.",
    language: "English",
    chapters: [
      {
        slug: "chapter-1",
        number: 1,
        title: "Chapter I",
        content: [
          "Temporary content for the Dracula reader preview.",
          "The real edition will be imported later from a verified public-domain source.",
        ],
      },
    ],
  },
  {
    id: "3",
    slug: "the-picture-of-dorian-gray",
    title: "The Picture of Dorian Gray",
    author: "Oscar Wilde",
    year: 1890,
    category: "Gothic Fiction",
    rating: 4.5,
    cover: "from-amber-900 to-stone-950",
    description:
      "Oscar Wilde's story of beauty, influence and moral corruption follows a man whose portrait bears the consequences of his choices.",
    language: "English",
    chapters: [
      {
        slug: "chapter-1",
        number: 1,
        title: "Chapter I",
        content: ["Temporary chapter content."],
      },
    ],
  },
  {
    id: "4",
    slug: "pride-and-prejudice",
    title: "Pride and Prejudice",
    author: "Jane Austen",
    year: 1813,
    category: "Romance",
    rating: 4.7,
    cover: "from-rose-900 to-stone-950",
    description: "Jane Austen's celebrated novel explores love, family, social expectations and first impressions.",
    language: "English",
    chapters: [
      {
        slug: "chapter-1",
        number: 1,
        title: "Chapter I",
        content: ["Temporary chapter content."],
      },
    ],
  },
  {
    id: "5",
    slug: "moby-dick",
    title: "Moby-Dick",
    author: "Herman Melville",
    year: 1851,
    category: "Adventure",
    rating: 4.2,
    cover: "from-sky-950 to-slate-950",
    description: "A voyage aboard the Pequod becomes Captain Ahab's relentless pursuit of the legendary white whale.",
    language: "English",
    chapters: [
      {
        slug: "chapter-1",
        number: 1,
        title: "Chapter I",
        content: ["Temporary chapter content."],
      },
    ],
  },
];

export const trendingBooks = books;

export function getBookBySlug(slug: string) {
  return books.find((book) => book.slug === slug);
}

export function getChapterBySlug(book: Book, chapterSlug: string) {
  return book.chapters.find((chapter) => chapter.slug === chapterSlug);
}
