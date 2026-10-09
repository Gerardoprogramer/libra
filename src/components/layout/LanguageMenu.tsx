"use client";

import type { ReactElement } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

export interface LanguageMenuProps {
  locale: Locale;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
}

export function LanguageMenu({ locale, open, onOpenChange, trigger }: LanguageMenuProps) {
  const pathname = usePathname();
  const router = useRouter();

  function changeLocale(nextLocale: Locale) {
    if (locale === nextLocale) return;
    router.replace(`${pathname}${window.location.search}${window.location.hash}`, { locale: nextLocale });
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onFocus={(event) => {
          // The first key/click can precede this chunk loading. Focus the menu
          // explicitly on that handoff; Radix retains keyboard/focus management.
          if (event.target === event.currentTarget) {
            event.currentTarget.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')?.focus();
          }
        }}
      >
        <DropdownMenuItem disabled={locale === "es"} onSelect={() => changeLocale("es")}>
          Español
        </DropdownMenuItem>
        <DropdownMenuItem disabled={locale === "en"} onSelect={() => changeLocale("en")}>
          English
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
