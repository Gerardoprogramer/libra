"use client";

import { useEffect, useState } from "react";

import { nextConnectionNotice, RESTORED_NOTICE_MS, type ConnectionNotice } from "@/lib/connection-status";

interface ConnectionStatusProps {
  offlineLabel: string;
  restoredLabel: string;
}

/**
 * Tells the reader when the browser reports the connection as lost, and briefly when it is back. It only reports the
 * state: nothing is cached for offline use. The status region is always in the page, empty while online, so screen
 * readers announce each change of its text, and only the changes. Nothing runs on the server.
 */
export function ConnectionStatus({ offlineLabel, restoredLabel }: ConnectionStatusProps) {
  // Null on the server and during hydration, so both render the empty region.
  const [notice, setNotice] = useState<ConnectionNotice>(null);

  useEffect(() => {
    const update = (online: boolean) => setNotice((current) => nextConnectionNotice(current, online));
    const online = () => update(true);
    const offline = () => update(false);

    // The connection may have dropped before hydration.
    if (!navigator.onLine) offline();
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);

    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, []);

  useEffect(() => {
    if (notice !== "restored") return;

    const timer = setTimeout(
      () => setNotice((current) => (current === "restored" ? null : current)),
      RESTORED_NOTICE_MS,
    );

    return () => clearTimeout(timer);
  }, [notice]);

  return (
    // Taps go through to the page: the notice only informs, and may lie over the reader's chapter links.
    // aria-live repeats what role="status" implies, because modal dialogs (the reader's chapter index, menus) hide
    // the rest of the page from screen readers and spare only [aria-live] elements (aria-hidden's hideOthers).
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      {notice && (
        <p className="bg-foreground text-background max-w-md rounded-full px-4 py-2 text-center text-sm shadow-lg">
          {notice === "offline" ? offlineLabel : restoredLabel}
        </p>
      )}
    </div>
  );
}
