import createMiddleware from "next-intl/middleware";
import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

import { routing } from "./i18n/routing";

const handleI18nRouting = createMiddleware(routing);

export async function proxy(request: NextRequest) {
  const response = handleI18nRouting(request);

  // If next-intl is redirecting/rejecting the request, let it finish first.
  // The redirected request will pass through the auth/session handling.
  if (!response.ok) {
    return response;
  }

  return updateSession(request, response);
}

export const config = {
  matcher: ["/((?!api|auth|_next|_vercel|.*\\..*|(?:es|en)/(?:.*/)?opengraph-image(?:/|$)).*)"],
};
