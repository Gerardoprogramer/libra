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

  async function changeLocale(nextLocale: Locale) {
    if (locale === nextLocale) return;

    const segments = pathname.split("/").filter(Boolean);

    const isReaderRoute = segments.length === 3 && segments[0] === "books";

    if (!isReaderRoute) {
      router.replace(`${pathname}${window.location.search}${window.location.hash}`, { locale: nextLocale });

      return;
    }

    const [, bookSlug, chapterSlug] = segments;

    try {
      const params = new URLSearchParams({
        book: bookSlug,
        chapter: chapterSlug,
        from: locale,
        to: nextLocale,
      });
      const query = new URLSearchParams(window.location.search);
      const edition = query.get("edition");
      if (edition) params.set("edition", edition);

      const response = await fetch(`/api/reader/locale-path?${params.toString()}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        return;
      }

      const data: { pathname?: string } = await response.json();

      if (!data.pathname) {
        return;
      }

      // The translated route resolves the target edition, not the original one.
      query.delete("edition");
      const search = query.size ? `?${query.toString()}` : "";
      router.replace(`${data.pathname}${search}${window.location.hash}`, { locale: nextLocale });
    } catch {
      // Keep the current page if the localized route cannot be resolved.
    }
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
