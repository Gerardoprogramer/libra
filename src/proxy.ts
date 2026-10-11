import createMiddleware from "next-intl/middleware";

import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Generated PNG routes already contain a validated locale. Skip language
  // negotiation/cookies so image crawlers and the CDN receive a plain response.
  matcher: ["/((?!api|_next|_vercel|.*\\..*|(?:es|en)/(?:.*/)?opengraph-image(?:/|$)).*)"],
};
