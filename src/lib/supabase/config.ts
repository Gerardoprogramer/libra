/**
 * Supabase settings shared by the browser, server and proxy clients. Both values are public by design (the
 * publishable key only identifies the project; Row Level Security and the session decide access), so they
 * may carry the NEXT_PUBLIC_ prefix. A service-role key must never be configured here.
 */
export function getSupabaseConfig() {
  // Literal property accesses: Next.js inlines NEXT_PUBLIC_* values into the browser bundle only in this form.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must both be set (see .env.example).",
    );
  }

  return { url, publishableKey };
}
