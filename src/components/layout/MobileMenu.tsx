"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FiMenu } from "react-icons/fi";

import { usePathname } from "@/i18n/navigation";

interface MobileMenuProps {
  label: string;
  children: ReactNode;
}

/** Navigation for small screens: closes on a link, on Escape, on an outside click and on every navigation. */
export function MobileMenu({ label, children }: MobileMenuProps) {
  const pathname = usePathname();
  // The menu is open only for the page it was opened on, so landing on another page closes it without an effect.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const container = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (container.current && !container.current.contains(event.target as Node)) setOpenAt(null);
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);

    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [open]);

  return (
    <details
      ref={container}
      open={open}
      className="relative md:hidden"
      onToggle={(event) => setOpenAt(event.currentTarget.open ? pathname : null)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpenAt(null);
          container.current?.querySelector("summary")?.focus();
        }
      }}
    >
      <summary className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex cursor-pointer list-none items-center gap-2 rounded-full px-3 py-2 text-sm transition focus-visible:ring-2">
        <FiMenu aria-hidden="true" className="size-4" />
        {label}
      </summary>

      <nav
        className="bg-popover absolute top-full right-0 z-50 mt-2 grid min-w-44 gap-1 rounded-xl border p-2 shadow-lg"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) setOpenAt(null);
        }}
      >
        {children}
      </nav>
    </details>
  );
}
