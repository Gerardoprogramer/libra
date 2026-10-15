import type { Metadata } from "next";

import { getTranslations } from "next-intl/server";

import { PasswordResetRequestForm } from "@/components/auth/PasswordForms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");

  return {
    title: t("forgotTitle"),
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default function ForgotPasswordPage() {
  return <PasswordResetRequestForm />;
}
