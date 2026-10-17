import { Suspense } from "react";

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { PasswordResetForm } from "@/components/auth/PasswordForms";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { hasRecoverySession } from "@/lib/auth-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");

  return {
    title: t("resetTitle"),
    robots: {
      index: false,
      follow: false,
    },
  };
}

// The reset link signs the user in through /auth/callback before landing here. Without that session the link
// was invalid, expired or already used, and there is nothing to change. A session from an ordinary sign-in is not
// enough: whoever holds it (a stolen cookie, a shared computer) must not change the password without the mailbox.
async function ResetPasswordContent() {
  const [t, recovering] = await Promise.all([getTranslations("auth"), hasRecoverySession()]);

  if (recovering) return <PasswordResetForm />;

  return (
    <main id="main-content" className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center px-6 py-12">
      <div className="w-full rounded-2xl border p-6 shadow-sm sm:p-8">
        <h1 className="font-serif text-3xl tracking-tight">{t("resetTitle")}</h1>

        <p role="alert" className="text-muted-foreground mt-3 text-sm leading-6">
          {t("resetLinkInvalid")}
        </p>

        <Button asChild className="mt-6">
          <Link href="/forgot-password">{t("requestNewLink")}</Link>
        </Button>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<main id="main-content" aria-busy="true" className="min-h-[calc(100vh-4rem)]" />}>
      <ResetPasswordContent />
    </Suspense>
  );
}
