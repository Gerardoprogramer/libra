// Supabase Auth error codes mapped to the message keys of the `auth` namespace. Anything unrecognized becomes
// the generic message: what the server said is never shown, and nothing reveals whether an address is registered.

export type AuthMessageKey = "genericError" | "invalidCredentials" | "weakPassword" | "emailNotConfirmed";

interface AuthErrorLike {
  code?: string;
}

export function signInMessageKey(error: AuthErrorLike | null | undefined): AuthMessageKey {
  switch (error?.code) {
    case "invalid_credentials":
      return "invalidCredentials";
    case "email_not_confirmed":
      return "emailNotConfirmed";
    default:
      // Network failures and rate limits are not a wrong password.
      return "genericError";
  }
}

export function signUpMessageKey(error: AuthErrorLike | null | undefined): AuthMessageKey {
  return error?.code === "weak_password" ? "weakPassword" : "genericError";
}

export function passwordUpdateMessageKey(error: AuthErrorLike | null | undefined): AuthMessageKey {
  return error?.code === "weak_password" ? "weakPassword" : "genericError";
}
