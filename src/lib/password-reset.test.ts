import assert from "node:assert/strict";
import { test } from "node:test";

import { type PasswordResetAuth, resetPasswordAndEndSession } from "./password-reset";

// Values are placeholders: nothing here is a real password.
const NEW_PASSWORD = "placeholder-new-password";

function fakeAuth({
  updateError = null,
  updateThrows = false,
  signOutError = null,
  signOutThrows = false,
}: {
  updateError?: { code?: string } | null;
  updateThrows?: boolean;
  signOutError?: unknown;
  signOutThrows?: boolean;
} = {}) {
  const calls: string[] = [];
  const auth: PasswordResetAuth = {
    async updateUser({ password }) {
      calls.push(`updateUser:${password === NEW_PASSWORD ? "new" : "other"}`);
      if (updateThrows) throw new Error("network down");
      return { error: updateError };
    },
    async signOut({ scope }) {
      calls.push(`signOut:${scope}`);
      if (signOutThrows) throw new Error("network down");
      return { error: signOutError };
    },
  };

  return { auth, calls };
}

test("F-03: a successful reset ends the recovery session, only after the password change is confirmed", async () => {
  const { auth, calls } = fakeAuth();

  assert.deepEqual(await resetPasswordAndEndSession(auth, NEW_PASSWORD, NEW_PASSWORD), {
    status: "updated",
    sessionClosed: true,
  });
  // `local` ends this session; it never signs out the user's other devices.
  assert.deepEqual(calls, ["updateUser:new", "signOut:local"]);
});

test("F-03: a failed password change keeps the existing messages and never ends the session", async () => {
  for (const [options, messageKey] of [
    [{ updateError: { code: "weak_password" } }, "weakPassword"],
    [{ updateError: { code: "same_password" } }, "genericError"],
    [{ updateError: { code: "current_password_required" } }, "genericError"],
    [{ updateError: { code: "reauthentication_needed" } }, "genericError"],
    [{ updateThrows: true }, "genericError"],
  ] as const) {
    const { auth, calls } = fakeAuth(options);

    assert.deepEqual(await resetPasswordAndEndSession(auth, NEW_PASSWORD, NEW_PASSWORD), {
      status: "failed",
      messageKey,
    });
    assert.deepEqual(calls, ["updateUser:new"]);
  }
});

test("F-03: a failed sign-out keeps the password change reported as done and says the session is still open", async () => {
  for (const options of [{ signOutError: new Error("rate limited") }, { signOutThrows: true }]) {
    const { auth, calls } = fakeAuth(options);

    assert.deepEqual(await resetPasswordAndEndSession(auth, NEW_PASSWORD, NEW_PASSWORD), {
      status: "updated",
      sessionClosed: false,
    });
    assert.deepEqual(calls, ["updateUser:new", "signOut:local"]);
  }
});

test("F-03: a confirmation that does not match is rejected without calling Supabase", async () => {
  const { auth, calls } = fakeAuth();

  assert.deepEqual(await resetPasswordAndEndSession(auth, NEW_PASSWORD, `${NEW_PASSWORD}x`), { status: "mismatch" });
  assert.deepEqual(calls, []);
});
