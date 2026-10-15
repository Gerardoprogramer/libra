"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

export default function LocaleError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useTranslations("errors");

  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center px-6 text-center"
    >
      <h1 className="font-serif text-4xl tracking-tight">{t("errorTitle")}</h1>
      <p className="text-muted-foreground mt-4 max-w-lg leading-7">{t("errorDescription")}</p>
      <Button className="mt-7" onClick={retry}>
        {t("retry")}
      </Button>
    </main>
  );
}
