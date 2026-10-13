import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

function getSafeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/es";
  }

  if (!/^\/(?:es|en)(?:\/|$)/.test(value)) {
    return "/es";
  }

  return value;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);

  const code = requestUrl.searchParams.get("code");
  const next = getSafeNext(requestUrl.searchParams.get("next"));

  if (code) {
    const supabase = await createClient();

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(next, requestUrl.origin));
    }
  }

  const locale = next.startsWith("/en") ? "en" : "es";

  const errorUrl = new URL(`/${locale}/login`, requestUrl.origin);
  errorUrl.searchParams.set("error", "auth");

  return NextResponse.redirect(errorUrl);
}
