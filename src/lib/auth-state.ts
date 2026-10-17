import "server-only";

import { cache } from "react";

import { isRecoverySession } from "@/lib/recovery-session";
import { createClient } from "@/lib/supabase/server";

// The verified claims of the request's session, or null without one. Memoized per request.
const getVerifiedClaims = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  return !error && data?.claims?.sub ? data.claims : null;
});

/**
 * Whether the request carries a valid session. This only decides which links to show; every page and API
 * that guards data checks the session itself. Memoized per request so several components can ask.
 */
export const isAuthenticated = cache(async (): Promise<boolean> => Boolean(await getVerifiedClaims()));

/**
 * Whether the request's session was opened from a password reset (or another emailed) link in the last few minutes,
 * not a sign-in. Only such a session is offered the reset form. This decides what the page shows and does not stop a
 * direct API call: Supabase Auth's "require current password" exempts every recovery session, whatever its age, and
 * accounts that have no password yet.
 */
export const hasRecoverySession = cache(async (): Promise<boolean> => isRecoverySession(await getVerifiedClaims()));
