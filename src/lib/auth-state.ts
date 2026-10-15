import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

/**
 * Whether the request carries a valid session. This only decides which links to show; every page and API
 * that guards data checks the session itself. Memoized per request so several components can ask.
 */
export const isAuthenticated = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  return !error && Boolean(data?.claims?.sub);
});
