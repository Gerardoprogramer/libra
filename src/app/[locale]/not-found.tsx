import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

export default async function LocaleNotFound() {
  const [t, catalog] = await Promise.all([getTranslations("errors"), getTranslations("catalog")]);

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center px-6 text-center">
      <p className="text-muted-foreground text-sm">404</p>
      <h1 className="mt-3 font-serif text-4xl tracking-tight">{t("notFoundTitle")}</h1>
      <p className="text-muted-foreground mt-4 max-w-lg leading-7">{t("notFoundDescription")}</p>
      <Button className="mt-7" asChild>
        <Link href="/books">{catalog("title")}</Link>
      </Button>
    </main>
  );
}
