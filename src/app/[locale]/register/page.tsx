import type { Metadata } from "next";

import { getTranslations } from "next-intl/server";

import { AuthPage, type AuthSearchParams } from "@/components/auth/AuthPage";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");

  return {
    title: t("registerTitle"),
    robots: {
      index: false,
      follow: true,
    },
  };
}

export default function RegisterPage({ searchParams }: { searchParams: Promise<AuthSearchParams> }) {
  return <AuthPage mode="register" searchParams={searchParams} />;
}
