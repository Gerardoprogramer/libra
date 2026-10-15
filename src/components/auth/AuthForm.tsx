"use client";

import { useState } from "react";

import { useLocale, useTranslations } from "next-intl";
import { FiArrowRight, FiMail } from "react-icons/fi";
import { FcGoogle } from "react-icons/fc";

import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";

interface AuthFormProps {
  mode: "login" | "register";
}

export function AuthForm({ mode }: AuthFormProps) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  const isRegister = mode === "register";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError(null);
    setSuccess(false);
    setPending(true);

    const supabase = createClient();

    try {
      if (isRegister) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(`/${locale}/library`)}`,
          },
        });

        if (signUpError) {
          setError(t("genericError"));
          return;
        }

        if (data.session) {
          router.replace("/library");
          router.refresh();
          return;
        }

        setSuccess(true);
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(t("invalidCredentials"));
        return;
      }

      router.replace("/library");
      router.refresh();
    } catch {
      setError(t("genericError"));
    } finally {
      setPending(false);
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    setPending(true);

    const supabase = createClient();

    try {
      const next = `/${locale}/library`;

      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });

      if (oauthError || !data.url) {
        setError(t("genericError"));
        setPending(false);
        return;
      }

      window.location.assign(data.url);
    } catch {
      setError(t("genericError"));
      setPending(false);
    }
  }

  if (success) {
    return (
      <main id="main-content" className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center px-6 py-12">
        <div className="w-full rounded-2xl border p-6 shadow-sm sm:p-8">
          <div className="mb-6 flex size-12 items-center justify-center rounded-full border">
            <FiMail className="size-5" aria-hidden="true" />
          </div>

          <h1 className="font-serif text-3xl tracking-tight">{t("checkEmailTitle")}</h1>

          <p className="text-muted-foreground mt-3 text-sm leading-6">{t("checkEmailDescription")}</p>

          <p className="mt-6 text-sm">
            {t("alreadyHaveAccount")}{" "}
            <Link href="/login" className="font-medium underline underline-offset-4">
              {t("signIn")}
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main id="main-content" className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center px-6 py-12">
      <div className="w-full rounded-2xl border p-6 shadow-sm sm:p-8">
        <div className="mb-8">
          <h1 className="font-serif text-3xl tracking-tight">{isRegister ? t("registerTitle") : t("loginTitle")}</h1>

          <p className="text-muted-foreground mt-2 text-sm">
            {isRegister ? t("registerDescription") : t("loginDescription")}
          </p>
        </div>

        {error && (
          <div role="alert" className="border-destructive/30 bg-destructive/5 mb-5 rounded-lg border px-4 py-3 text-sm">
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
              className="border-input bg-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              {t("password")}
            </label>

            <input
              id="password"
              name="password"
              type="password"
              autoComplete={isRegister ? "new-password" : "current-password"}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="border-input bg-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
            />
          </div>

          <Button type="submit" disabled={pending} className="w-full">
            {isRegister ? t("register") : t("signIn")}
            <FiArrowRight aria-hidden="true" />
          </Button>
        </form>

        <div className="my-6 flex items-center gap-3">
          <div className="bg-border h-px flex-1" />
          <span className="text-muted-foreground text-xs uppercase">{t("or")}</span>
          <div className="bg-border h-px flex-1" />
        </div>

        <Button type="button" variant="outline" disabled={pending} onClick={handleGoogleSignIn} className="w-full">
          <FcGoogle aria-hidden="true" />
          {t("continueWithGoogle")}
        </Button>

        <p className="text-muted-foreground mt-6 text-center text-sm">
          {isRegister ? t("alreadyHaveAccount") : t("noAccount")}{" "}
          <Link
            href={isRegister ? "/login" : "/register"}
            className="text-foreground font-medium underline underline-offset-4"
          >
            {isRegister ? t("signIn") : t("createAccount")}
          </Link>
        </p>
      </div>
    </main>
  );
}
