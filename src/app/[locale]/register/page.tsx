import type { Metadata } from "next";

import { getTranslations } from "next-intl/server";

import { AuthForm } from "@/components/auth/AuthForm";

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

export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
