"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

// Set after the first hydration in the document.
let hydrated = false;
const subscribe = () => () => {};
// true on the server and while hydrating (getServerSnapshot), so the server's HTML is adopted as it is; true too for
// the hydration's own consistency check, which runs before the effect below. false for any later mount in the browser.
const getSnapshot = () => !hydrated;
const getServerSnapshot = () => true;

// An inline script that runs from the server's HTML, while the browser parses it. React never runs a <script> it renders
// in the browser, so a later mount (the layout rendered again on a locale switch) renders nothing instead of a copy;
// the decision is kept per instance, so the hydrated script stays if its instance renders again. Should the browser
// ever render one, it is a data block (type="text/plain"), which React neither runs nor warns about;
// suppressHydrationWarning covers the type, which differs between the server's HTML and the browser. After the
// Next.js guide "Preventing flash before hydration"; a Client Component so that this is decided in the browser too.
export function InlineScript({ html }: { html: string }) {
  const [render] = useState(useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot));

  useEffect(() => {
    hydrated = true;
  }, []);

  if (!render) return null;

  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
