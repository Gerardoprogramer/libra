import { getLocale, getTranslations } from "next-intl/server";

import { getCategories, type ContentLocale } from "@/db/queries/books";

import { Link } from "@/i18n/navigation";

export default async function CategoriesPage() {
  const locale = (await getLocale()) as ContentLocale;

  const t = await getTranslations("catalog");

  const categories = await getCategories(locale);

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-14 md:py-20">
      <header className="max-w-3xl">
        <p className="text-muted-foreground mb-3 text-xs tracking-[0.25em] uppercase">{t("categoriesEyebrow")}</p>

        <h1 className="font-serif text-5xl tracking-tight md:text-6xl">{t("categoriesTitle")}</h1>

        <p className="text-muted-foreground mt-5 max-w-2xl text-lg leading-8">{t("categoriesDescription")}</p>
      </header>

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((category) => (
          <Link
            key={category.id}
            href={`/books?category=${category.slug}`}
            className="group hover:bg-muted/40 border p-7 transition"
          >
            <p className="font-serif text-2xl">{category.name}</p>

            <p className="text-muted-foreground mt-2 text-sm">
              {t("booksInCategory", {
                count: category.bookCount,
              })}
            </p>

            <p className="text-muted-foreground group-hover:text-foreground mt-8 text-sm transition">
              {locale === "es" ? "Explorar →" : "Explore →"}
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
