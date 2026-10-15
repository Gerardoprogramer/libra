"use client";

import { Button } from "@/components/ui/button";
import { clearSyncedScopedReadingProgress } from "@/lib/reading-progress";
import { flushReadingProgress } from "@/lib/reading-progress-sync";

interface SignOutFormProps {
  /** The server action that ends the session. */
  action: (formData: FormData) => void | Promise<void>;
  locale: string;
  userId: string;
  label: string;
}

/**
 * Signing out also empties this browser's cached reading progress for the account, except changes that have
 * not reached the server yet; those stay in the outbox for the next sign-in of the same user.
 */
export function SignOutForm({ action, locale, userId, label }: SignOutFormProps) {
  return (
    <form
      action={action}
      onSubmit={() => {
        const scope = { type: "user", userId } as const;

        // keepalive requests survive the navigation that follows; whatever is not acknowledged stays queued.
        flushReadingProgress(scope);
        clearSyncedScopedReadingProgress(scope);
      }}
    >
      <input type="hidden" name="locale" value={locale} />

      <Button type="submit" variant="outline">
        {label}
      </Button>
    </form>
  );
}
