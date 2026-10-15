import { Suspense } from "react";

import { getLocale, getTranslations } from "next-intl/server";
import { FiSearch } from "react-icons/fi";
import { HiOutlineBookOpen } from "react-icons/hi2";

import { HeaderAuth, HeaderAuthFallback, MobileMenuAuthLinks } from "@/components/layout/HeaderAuth";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { MobileMenu } from "@/components/layout/MobileMenu";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

// The session is read only inside the Suspense boundaries below, so the rest of the header, and the page
// under it, never waits for the cookies.
export async function Header() {
  const [t, locale] = await Promise.all([getTranslations("nav"), getLocale()]);
  const menuLink = "hover:bg-muted rounded-lg px-3 py-2 text-sm";

  return (
    <header className="bg-background/90 sticky top-0 z-50 border-b backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center px-6">
        <Link href="/" className="flex items-center gap-2 md:mr-10">
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
          <MobileMenu label={t("menu")}>
            <Link href="/books" className={menuLink}>
              {t("discover")}
            </Link>
            <Link href="/categories" className={menuLink}>
              {t("categories")}
            </Link>
            <Link href="/authors" className={menuLink}>
              {t("authors")}
            </Link>
            <Link href="/library" className={menuLink}>
              {t("library")}
            </Link>
            <Suspense fallback={null}>
              <MobileMenuAuthLinks />
            </Suspense>
          </MobileMenu>

          <LanguageSwitcher
            locale={locale as Locale}
            label={t("language", { locale })}
            errorLabel={t("languageLoadError")}
          />

          <Suspense fallback={<HeaderAuthFallback />}>
            <HeaderAuth />
          </Suspense>

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
