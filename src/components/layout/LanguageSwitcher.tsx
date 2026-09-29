"use client";

import { useLocale } from "next-intl";
import { FiGlobe } from "react-icons/fi";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

export function LanguageSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  function changeLocale(nextLocale: Locale) {
    if (locale === nextLocale) {
      return;
    }

    router.replace(pathname, {
      locale: nextLocale,
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 uppercase">
          <FiGlobe />
          {locale}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={locale === "es"} onClick={() => changeLocale("es")}>
          Español
        </DropdownMenuItem>

        <DropdownMenuItem disabled={locale === "en"} onClick={() => changeLocale("en")}>
          English
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
