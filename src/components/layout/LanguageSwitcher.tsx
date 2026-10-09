"use client";

import { useRef, useState, type ComponentType } from "react";
import { FiGlobe } from "react-icons/fi";

import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/routing";
import type { LanguageMenuProps } from "./LanguageMenu";

let menuPromise: Promise<typeof import("./LanguageMenu")> | undefined;

function loadMenu() {
  menuPromise ??= import("./LanguageMenu").catch((error: unknown) => {
    menuPromise = undefined;
    throw error;
  });
  return menuPromise;
}

function preloadMenu() {
  // Hover/focus starts the download without replacing the focused SSR button.
  void loadMenu().catch(() => {});
}

export function LanguageSwitcher({ locale, label, errorLabel }: { locale: Locale; label: string; errorLabel: string }) {
  const [Menu, setMenu] = useState<ComponentType<LanguageMenuProps> | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const requested = useRef(false);

  async function openMenu() {
    requested.current = true;
    setPending(true);
    setFailed(false);
    try {
      const loadedMenu = await loadMenu();
      if (requested.current) {
        setMenu(() => loadedMenu.LanguageMenu);
        setOpen(true);
      }
    } catch {
      if (requested.current) setFailed(true);
    } finally {
      setPending(false);
    }
  }

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="gap-2 uppercase"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-busy={pending || undefined}
      onPointerEnter={preloadMenu}
      onFocus={preloadMenu}
      onClick={Menu ? undefined : openMenu}
      onBlur={() => {
        requested.current = false;
      }}
      onKeyDown={
        Menu
          ? undefined
          : (event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                void openMenu();
              } else if (event.key === "Escape") {
                requested.current = false;
                setPending(false);
              }
            }
      }
    >
      <FiGlobe aria-hidden="true" />
      {locale}
    </Button>
  );

  return (
    <>
      {Menu ? <Menu locale={locale} open={open} onOpenChange={setOpen} trigger={trigger} /> : trigger}
      {failed && (
        <span role="alert" className="sr-only">
          {errorLabel}
        </span>
      )}
    </>
  );
}
