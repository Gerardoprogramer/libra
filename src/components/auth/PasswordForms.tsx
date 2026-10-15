"use client";

import { useState } from "react";

import { useLocale, useTranslations } from "next-intl";
import { FiArrowRight, FiCheckCircle, FiMail } from "react-icons/fi";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { passwordUpdateMessageKey } from "@/lib/auth-errors";
import { createClient } from "@/lib/supabase/client";

const inputClass =
  "border-input bg-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2";

function Card({ children }: { children: React.ReactNode }) {
  return (
    <main id="main-content" className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center px-6 py-12">
      <div className="w-full rounded-2xl border p-6 shadow-sm sm:p-8">{children}</div>
    </main>
  );
}

/** Asks Supabase to email a reset link. The answer never says whether the address has an account. */
export function PasswordResetRequestForm() {
  const t = useTranslations("auth");
  const locale = useLocale();

  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const { error: requestError } = await createClient().auth.resetPasswordForEmail(email.trim(), {
        // The callback only follows validated, locale-prefixed local paths (see safeAuthRedirect).
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(`/${locale}/reset-password`)}`,
      });

      // An unknown address is not an error here; only a failed request (network, rate limit) is.
      if (requestError) {
        setError(t("genericError"));
        return;
      }

      setSent(true);
    } catch {
      setError(t("genericError"));
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <Card>
        <div className="mb-6 flex size-12 items-center justify-center rounded-full border">
          <FiMail className="size-5" aria-hidden="true" />
        </div>

        <h1 className="font-serif text-3xl tracking-tight">{t("resetEmailSentTitle")}</h1>

        <p role="status" className="text-muted-foreground mt-3 text-sm leading-6">
          {t("resetEmailSentDescription")}
        </p>

        <p className="mt-6 text-sm">
          <Link href="/login" className="font-medium underline underline-offset-4">
            {t("backToSignIn")}
          </Link>
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="font-serif text-3xl tracking-tight">{t("forgotTitle")}</h1>

      <p className="text-muted-foreground mt-2 mb-8 text-sm">{t("forgotDescription")}</p>

      {error && (
        <div
          id="reset-error"
          role="alert"
          className="border-destructive/30 bg-destructive/5 mb-5 rounded-lg border px-4 py-3 text-sm"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            {t("email")}
          </label>

          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "reset-error" : undefined}
            className={inputClass}
          />
        </div>

        <Button type="submit" disabled={pending} className="w-full">
          {t("sendResetLink")}
          <FiArrowRight aria-hidden="true" />
        </Button>
      </form>

      <p className="mt-6 text-center text-sm">
        <Link href="/login" className="text-muted-foreground hover:text-foreground underline underline-offset-4">
          {t("backToSignIn")}
        </Link>
      </p>
    </Card>
  );
}

/** Chooses the new password. Rendered only for a request that already holds the recovery session. */
export function PasswordResetForm() {
  const t = useTranslations("auth");

  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirmation) {
      setError(t("passwordMismatch"));
      return;
    }

    setPending(true);

    try {
      const { error: updateError } = await createClient().auth.updateUser({ password });

      if (updateError) {
        setError(t(passwordUpdateMessageKey(updateError)));
        return;
      }

      setDone(true);
    } catch {
      setError(t("genericError"));
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <Card>
        <div className="mb-6 flex size-12 items-center justify-center rounded-full border">
          <FiCheckCircle className="size-5" aria-hidden="true" />
        </div>

        <h1 className="font-serif text-3xl tracking-tight">{t("passwordUpdatedTitle")}</h1>

        <p role="status" className="text-muted-foreground mt-3 text-sm leading-6">
          {t("passwordUpdatedDescription")}
        </p>

        <Button asChild className="mt-6">
          <Link href="/account">{t("goToAccount")}</Link>
        </Button>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="font-serif text-3xl tracking-tight">{t("resetTitle")}</h1>

      <p className="text-muted-foreground mt-2 mb-8 text-sm">{t("resetDescription")}</p>

      {error && (
        <div
          id="reset-error"
          role="alert"
          className="border-destructive/30 bg-destructive/5 mb-5 rounded-lg border px-4 py-3 text-sm"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="new-password" className="text-sm font-medium">
            {t("newPassword")}
          </label>

          <input
            id="new-password"
            name="new-password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "reset-error" : undefined}
            className={inputClass}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="confirm-password" className="text-sm font-medium">
            {t("confirmPassword")}
          </label>

          <input
            id="confirm-password"
            name="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "reset-error" : undefined}
            className={inputClass}
          />
        </div>

        <Button type="submit" disabled={pending} className="w-full">
          {t("savePassword")}
          <FiArrowRight aria-hidden="true" />
        </Button>
      </form>
    </Card>
  );
}
