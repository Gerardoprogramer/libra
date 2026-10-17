import { Suspense } from "react";

import { getLocale } from "next-intl/server";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/AuthForm";
import { isAuthenticated } from "@/lib/auth-state";
import { safeNextPath } from "@/lib/auth-redirect";

export interface AuthSearchParams {
  next?: string | string[];
  error?: string | string[];
  reset?: string | string[];
}

// Only the path matters: `next` must be a locale-prefixed local path, never an absolute URL.
const placeholderOrigin = "https://libra.invalid";

async function AuthPageContent({
  mode,
  searchParams,
}: {
  mode: "login" | "register";
  searchParams: Promise<AuthSearchParams>;
}) {
  const [{ next, error, reset }, locale, signedIn] = await Promise.all([searchParams, getLocale(), isAuthenticated()]);
  const nextPath = safeNextPath(typeof next === "string" ? next : null, placeholderOrigin);

  // Someone who is already signed in has nothing to do here.
  if (signedIn) redirect(nextPath ?? `/${locale}/account`);

  return (
    <AuthForm
      mode={mode}
      next={nextPath}
      callbackError={error === "auth_callback"}
      // Set by the password reset after it ended the recovery session; it only selects a fixed message.
      passwordReset={mode === "login" && reset === "done"}
    />
  );
}

/** Login and register pages: reads the request (the return path, a callback error, the session) behind Suspense. */
export function AuthPage(props: { mode: "login" | "register"; searchParams: Promise<AuthSearchParams> }) {
  return (
    <Suspense fallback={<main id="main-content" aria-busy="true" className="min-h-[calc(100vh-4rem)]" />}>
      <AuthPageContent {...props} />
    </Suspense>
  );
}
