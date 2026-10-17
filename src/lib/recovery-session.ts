// Whether verified access-token claims belong to a recent session opened from an emailed link rather than a password
// or OAuth sign-in. It mirrors Supabase Auth's own `Session.IsRecovery` (supabase/auth, internal/models/sessions.go):
// the `amr` claim lists how the session was authenticated, and Auth treats "recovery" (the PKCE reset link used
// here), "otp" (the implicit and verifyOtp flows) and "magiclink" as proof that the user controls the mailbox.
// A session that only signed in with a password, OAuth, SSO or MFA never carries any of them.
//
// Auth keeps that proof for the whole life of the session, so it is also bounded in time here. An `amr` entry's
// timestamp is when the session was created with that method (`mfa_amr_claims.updated_at`): a refreshed access token
// carries the same timestamp, unlike `iat`, so an old recovery session cannot look recent by refreshing. The claims
// are only trusted once `getClaims()` has verified their signature.

const RECOVERY_METHODS = new Set(["recovery", "otp", "magiclink"]);

/** How long after the reset link was opened its session is still offered the new-password form. */
export const RECOVERY_MAX_AGE_SECONDS = 15 * 60;

// Tolerated difference between the Auth server's clock and this server's.
const CLOCK_SKEW_SECONDS = 60;

function recoveryTimestamp(entry: unknown): number | undefined {
  // RFC 8176 strings, which a custom access token hook may emit instead, carry no time and never count as recent.
  if (typeof entry !== "object" || entry === null || !("method" in entry) || !("timestamp" in entry)) return undefined;
  if (typeof entry.method !== "string" || !RECOVERY_METHODS.has(entry.method)) return undefined;

  return typeof entry.timestamp === "number" && Number.isFinite(entry.timestamp) ? entry.timestamp : undefined;
}

export function isRecoverySession(
  claims: { amr?: unknown } | null | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const amr = claims?.amr;
  if (!Array.isArray(amr)) return false;

  return amr.some((entry) => {
    const timestamp = recoveryTimestamp(entry);
    if (timestamp === undefined) return false;

    const age = nowSeconds - timestamp;
    return age >= -CLOCK_SKEW_SECONDS && age <= RECOVERY_MAX_AGE_SECONDS;
  });
}
