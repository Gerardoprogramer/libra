"use server";

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

  // No cache is invalidated here. The session is never part of cached data (it is only read in dynamic,
  // Suspense-wrapped components), and clearing the auth cookies in a Server Action already re-renders the UI;
  // the redirect then streams a freshly rendered page. A global revalidatePath would let anyone, even without a
  // session, purge the whole site's cache by calling this action.
  redirect(`/${locale}`);
}
