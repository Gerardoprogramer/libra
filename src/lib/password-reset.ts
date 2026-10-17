// Sets the new password from a recovery session, then ends that session. A session opened from a reset link is
// privileged for its whole life: Supabase lets it change the password without the current one. Once the reset is
// done it is closed (`scope: "local"` revokes it on the server and clears it from this browser), so it cannot be
// reused, and the user signs in again with the new password. Other sessions are left to Supabase.

import { type AuthMessageKey, passwordUpdateMessageKey } from "@/lib/auth-errors";

export interface PasswordResetAuth {
  updateUser(attributes: { password: string }): Promise<{ error: { code?: string } | null }>;
  signOut(options: { scope: "local" }): Promise<{ error: unknown }>;
}

export type PasswordResetResult =
  | { status: "mismatch" }
  | { status: "failed"; messageKey: AuthMessageKey }
  // The password changed in every case; `sessionClosed` says whether the recovery session was ended as well.
  | { status: "updated"; sessionClosed: boolean };

export async function resetPasswordAndEndSession(
  auth: PasswordResetAuth,
  password: string,
  confirmation: string,
): Promise<PasswordResetResult> {
  if (password !== confirmation) return { status: "mismatch" };

  try {
    const { error } = await auth.updateUser({ password });

    if (error) return { status: "failed", messageKey: passwordUpdateMessageKey(error) };
  } catch {
    return { status: "failed", messageKey: "genericError" };
  }

  // Only now, with the change confirmed: a failure here must not be reported as a failed password change.
  try {
    const { error } = await auth.signOut({ scope: "local" });

    return { status: "updated", sessionClosed: !error };
  } catch {
    return { status: "updated", sessionClosed: false };
  }
}
