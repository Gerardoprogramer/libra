"use server";

import { revalidatePath } from "next/cache";
import { hasLocale } from "next-intl";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { routing } from "@/i18n/routing";

export async function signOut(formData: FormData) {
  const requestedLocale = formData.get("locale");

  const locale =
    typeof requestedLocale === "string" && hasLocale(routing.locales, requestedLocale)
      ? requestedLocale
      : routing.defaultLocale;

  const supabase = await createClient();

  const { error } = await supabase.auth.signOut({
    scope: "local",
  });

  if (error) {
    throw error;
  }

  revalidatePath("/", "layout");

  redirect(`/${locale}`);
}
