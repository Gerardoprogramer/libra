import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { safeAuthRedirect } from "@/lib/auth-redirect";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);

  const code = requestUrl.searchParams.get("code");
  const destination = safeAuthRedirect(requestUrl.searchParams.get("next"), requestUrl.origin);
  const locale = destination.pathname.split("/")[1];

  if (!code) {
    // Supabase reports a failed verification (an expired or already used link, a cancelled consent) with error
    // parameters instead of a code. Only their presence is used: the login page shows its own message, and the
    // provider's text is never forwarded.
    const failed = ["error", "error_code", "error_description"].some((name) => requestUrl.searchParams.has(name));

    return NextResponse.redirect(new URL(`/${locale}/login${failed ? "?error=auth_callback" : ""}`, requestUrl.origin));
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL(`/${locale}/login?error=auth_callback`, requestUrl.origin));
  }

  return NextResponse.redirect(destination);
}
