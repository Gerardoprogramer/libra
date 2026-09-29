export interface Book {
    id: string;
    slug: string;
    title: string;
    author: string;
    year: number;
    category: string;
    rating: number;
    cover: string;
}

export const trendingBooks: Book[] = [
    {
        id: "1",
        slug: "frankenstein",
        title: "Frankenstein",
        author: "Mary Shelley",
        year: 1818,
        category: "Gothic Horror",
        rating: 4.7,
        cover: "from-slate-800 to-emerald-950",
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
    },
];