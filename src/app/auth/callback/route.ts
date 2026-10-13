import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { safeAuthRedirect } from "@/lib/auth-redirect";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);

  const code = requestUrl.searchParams.get("code");
  const destination = safeAuthRedirect(requestUrl.searchParams.get("next"), requestUrl.origin);
  const locale = destination.pathname.split("/")[1];

  if (!code) {
    return NextResponse.redirect(new URL(`/${locale}/login`, requestUrl.origin));
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL(`/${locale}/login?error=auth_callback`, requestUrl.origin));
  }

  return NextResponse.redirect(destination);
}
