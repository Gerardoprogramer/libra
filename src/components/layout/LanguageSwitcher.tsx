"use client";

import { useLocale, useTranslations } from "next-intl";
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
  const t = useTranslations("nav");
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
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 uppercase"
          aria-label={t("language", {
            locale,
          })}
        >
          <FiGlobe aria-hidden="true" />
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
