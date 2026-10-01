import { getTranslations } from "next-intl/server";

import { FiMenu, FiSearch } from "react-icons/fi";
import { HiOutlineBookOpen } from "react-icons/hi2";

import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

export async function Header() {
  const t = await getTranslations("nav");

  return (
    <header className="bg-background/90 sticky top-0 z-50 border-b backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center px-6">
        <Link href="/" className="mr-10 flex items-center gap-2">
          <HiOutlineBookOpen aria-hidden="true" className="size-6" />

          <span className="font-serif text-xl font-semibold tracking-tight">Libra</span>
        </Link>

        <nav className="hidden items-center gap-7 text-sm md:flex">
          <Link href="/books" className="text-muted-foreground hover:text-foreground transition">
            {t("discover")}
          </Link>

          <Link href="/categories" className="text-muted-foreground hover:text-foreground transition">
            {t("categories")}
          </Link>

          <Link href="/authors" className="text-muted-foreground hover:text-foreground transition">
            {t("authors")}
          </Link>

          <Link href="/library" className="text-muted-foreground hover:text-foreground transition">
            {t("library")}
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <details className="relative md:hidden">
            <summary className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex cursor-pointer list-none items-center gap-2 rounded-full px-3 py-2 text-sm transition focus-visible:ring-2">
              <FiMenu aria-hidden="true" className="size-4" />
              {t("menu")}
            </summary>

            <nav className="bg-popover absolute top-full right-0 z-50 mt-2 grid min-w-44 gap-1 rounded-xl border p-2 shadow-lg">
              <Link href="/books" className="hover:bg-muted rounded-lg px-3 py-2 text-sm">
                {t("discover")}
              </Link>
              <Link href="/categories" className="hover:bg-muted rounded-lg px-3 py-2 text-sm">
                {t("categories")}
              </Link>
              <Link href="/authors" className="hover:bg-muted rounded-lg px-3 py-2 text-sm">
                {t("authors")}
              </Link>
              <Link href="/library" className="hover:bg-muted rounded-lg px-3 py-2 text-sm">
                {t("library")}
              </Link>
            </nav>
          </details>

          <LanguageSwitcher />

          <Button variant="ghost" size="icon" asChild>
            <Link href="/books" aria-label={t("search")}>
              <FiSearch aria-hidden="true" className="size-5" />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
