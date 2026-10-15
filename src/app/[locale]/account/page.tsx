import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { routing } from "@/i18n/routing";

import { signOut } from "./actions";

export const instant = false;

interface AccountPageProps {
  params: Promise<{
    locale: string;
  }>;
}

export async function generateMetadata({ params }: AccountPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "account",
  });

  return {
    title: t("title"),
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default async function AccountPage({ params }: AccountPageProps) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    redirect(`/${routing.defaultLocale}`);
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    redirect(`/${locale}/login`);
  }

  const email = typeof data.claims.email === "string" ? data.claims.email : null;

  const t = await getTranslations({
    locale,
    namespace: "account",
  });

  return (
    <main id="main-content" className="mx-auto max-w-3xl px-6 py-12">
      <div className="space-y-8">
        <header className="space-y-2">
          <h1 className="font-serif text-3xl font-semibold tracking-tight">{t("title")}</h1>
        </header>

        <section className="bg-card rounded-2xl border p-6 shadow-sm">
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("email")}</p>
            <p className="text-muted-foreground text-sm break-all">{email ?? "—"}</p>
          </div>
        </section>

        <section className="bg-card rounded-2xl border p-6 shadow-sm">
          <div className="space-y-2">
            <h2 className="font-serif text-xl font-semibold">{t("syncTitle")}</h2>
            <p className="text-muted-foreground text-sm leading-6">{t("syncDescription")}</p>
          </div>
        </section>

        <form action={signOut}>
          <input type="hidden" name="locale" value={locale} />

          <Button type="submit" variant="outline">
            {t("signOut")}
          </Button>
        </form>
      </div>
    </main>
  );
}
