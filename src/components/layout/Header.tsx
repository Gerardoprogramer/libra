import { getLocale, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";

import { FiMenu, FiSearch, FiUser } from "react-icons/fi";
import { HiOutlineBookOpen } from "react-icons/hi2";

import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

export async function Header() {
  const [t, authT, locale, supabase] = await Promise.all([
    getTranslations("nav"),
    getTranslations("auth"),
    getLocale(),
    createClient(),
  ]);

  const { data, error } = await supabase.auth.getClaims();

  const isAuthenticated = !error && Boolean(data?.claims?.sub);

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
              {isAuthenticated ? (
                <Link href="/account" className="hover:bg-muted rounded-lg px-3 py-2 text-sm">
                  {authT("account")}
                </Link>
              ) : (
                <>
                  <Link href="/login" className="hover:bg-muted rounded-lg px-3 py-2 text-sm">
                    {authT("signIn")}
                  </Link>

                  <Link href="/register" className="hover:bg-muted rounded-lg px-3 py-2 text-sm">
                    {authT("register")}
                  </Link>
                </>
              )}
            </nav>
          </details>

          <LanguageSwitcher
            locale={locale as Locale}
            label={t("language", { locale })}
            errorLabel={t("languageLoadError")}
          />

          {isAuthenticated ? (
            <Button variant="ghost" size="icon" asChild>
              <Link href="/account" aria-label={authT("account")}>
                <FiUser aria-hidden="true" className="size-5" />
              </Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" className="hidden sm:inline-flex" asChild>
                <Link href="/login">{authT("signIn")}</Link>
              </Button>

              <Button className="hidden sm:inline-flex" asChild>
                <Link href="/register">{authT("register")}</Link>
              </Button>
            </>
          )}

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
