import { getTranslations } from "next-intl/server";
import { FiUser } from "react-icons/fi";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { isAuthenticated } from "@/lib/auth-state";

/** Account or sign-in actions of the desktop header. Reads the session, so it renders behind a Suspense boundary. */
export async function HeaderAuth() {
  const [authT, signedIn] = await Promise.all([getTranslations("auth"), isAuthenticated()]);

  if (signedIn) {
    return (
      <Button variant="ghost" size="icon" asChild>
        <Link href="/account" aria-label={authT("account")}>
          <FiUser aria-hidden="true" className="size-5" />
        </Link>
      </Button>
    );
  }

  return (
    <>
      <Button variant="ghost" className="hidden sm:inline-flex" asChild>
        <Link href="/login">{authT("signIn")}</Link>
      </Button>

      <Button className="hidden sm:inline-flex" asChild>
        <Link href="/register">{authT("register")}</Link>
      </Button>
    </>
  );
}

/** Reserves the space of the sign-in buttons while the session is read, so the header does not shift. */
export function HeaderAuthFallback() {
  return <div aria-hidden="true" className="hidden h-9 w-[11.5rem] sm:block" />;
}

/** The session-dependent entries of the mobile menu. */
export async function MobileMenuAuthLinks() {
  const [authT, signedIn] = await Promise.all([getTranslations("auth"), isAuthenticated()]);
  const link = "hover:bg-muted rounded-lg px-3 py-2 text-sm";

  if (signedIn) {
    return (
      <Link href="/account" className={link}>
        {authT("account")}
      </Link>
    );
  }

  return (
    <>
      <Link href="/login" className={link}>
        {authT("signIn")}
      </Link>

      <Link href="/register" className={link}>
        {authT("register")}
      </Link>
    </>
  );
}
