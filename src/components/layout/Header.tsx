import { getTranslations } from "next-intl/server";

import { FiSearch, FiUser } from "react-icons/fi";
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
          <HiOutlineBookOpen className="size-6" />

          <span className="font-serif text-xl font-semibold tracking-tight">Libra</span>
        </Link>

        <nav className="hidden items-center gap-7 text-sm md:flex">
          <Link href="/books" className="text-muted-foreground hover:text-foreground transition">
            {t("discover")}
          </Link>

          <Link href="/categories" className="text-muted-foreground hover:text-foreground transition">
            {t("categories")}
          </Link>

          <Link href="/library" className="text-muted-foreground hover:text-foreground transition">
            {t("library")}
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <LanguageSwitcher />

          <Button variant="ghost" size="icon">
            <FiSearch className="size-5" />
            <span className="sr-only">{t("search")}</span>
          </Button>

          <Button variant="ghost" size="icon">
            <FiUser className="size-5" />
            <span className="sr-only">{t("account")}</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
