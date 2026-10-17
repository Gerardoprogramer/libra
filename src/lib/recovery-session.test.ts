import assert from "node:assert/strict";
import { test } from "node:test";

import { isRecoverySession, RECOVERY_MAX_AGE_SECONDS } from "./recovery-session";

const at = 1_760_000_000;
// One minute after the link was opened.
const now = at + 60;

test("F-03: a session opened from the reset link (PKCE 'recovery', implicit or verifyOtp 'otp') is a recovery session", () => {
  for (const amr of [
    [{ method: "recovery", timestamp: at }],
    [{ method: "otp", timestamp: at }],
    [{ method: "magiclink", timestamp: at }],
    // Most recent first, as Auth orders them: an MFA step after the link keeps the session a recovery one.
    [
      { method: "mfa/totp", timestamp: at + 30 },
      { method: "recovery", timestamp: at },
    ],
  ]) {
    assert.equal(isRecoverySession({ amr }, now), true, JSON.stringify(amr));
  }
});

test("F-03: a session from an ordinary sign-in is never a recovery session", () => {
  for (const amr of [
    [{ method: "password", timestamp: at }],
    [{ method: "oauth", timestamp: at }],
    [{ method: "sso/saml", timestamp: at }],
    [{ method: "anonymous", timestamp: at }],
    [
      { method: "mfa/totp", timestamp: at + 30 },
      { method: "password", timestamp: at },
    ],
    // Recovery codes are a second factor, not an emailed link.
    [{ method: "mfa/recovery_code", timestamp: at }],
    ["password"],
    [],
  ]) {
    assert.equal(isRecoverySession({ amr }, now), false, JSON.stringify(amr));
  }
});

test("F-03: the reset link's session is offered the form for 15 minutes, and not after", () => {
  const amr = [{ method: "recovery", timestamp: at }];

  assert.equal(isRecoverySession({ amr }, at), true);
  assert.equal(isRecoverySession({ amr }, at + RECOVERY_MAX_AGE_SECONDS), true);
  assert.equal(isRecoverySession({ amr }, at + RECOVERY_MAX_AGE_SECONDS + 1), false);
  assert.equal(isRecoverySession({ amr }, at + 7 * 24 * 60 * 60), false);
});

test("F-03: refreshing the access token does not make an old recovery session recent", () => {
  // A refreshed token has a new `iat` and `exp`, but Auth re-signs the original amr timestamp.
  const refreshed = {
    iat: at + 3600,
    exp: at + 7200,
    amr: [{ method: "recovery", timestamp: at }],
  };

  assert.equal(isRecoverySession(refreshed, at + 3600), false);
});

test("F-03: a later sign-in step does not renew an old recovery", () => {
  const amr = [
    { method: "mfa/totp", timestamp: at + 3600 },
    { method: "recovery", timestamp: at },
  ];

  assert.equal(isRecoverySession({ amr }, at + 3600), false);
});

test("F-03: a recovery time only slightly ahead of this server's clock is accepted, a far future one is not", () => {
  assert.equal(isRecoverySession({ amr: [{ method: "recovery", timestamp: at + 30 }] }, at), true);
  assert.equal(isRecoverySession({ amr: [{ method: "recovery", timestamp: at + 3600 }] }, at), false);
});

test("F-03: missing or malformed claims are not a recovery session", () => {
  for (const claims of [
    null,
    undefined,
    {},
    { amr: "recovery" },
    { amr: { method: "recovery", timestamp: at } },
    // Strings from a custom access token hook carry no time, so their age cannot be checked.
    { amr: ["recovery"] },
    { amr: ["otp"] },
    { amr: [{ method: "recovery" }] },
    {
      amr: [
        { method: "recovery", timestamp: String(at) },
        { method: "recovery", timestamp: Number.NaN },
        { method: "recovery", timestamp: Number.POSITIVE_INFINITY },
        { method: "recovery", timestamp: null },
      ],
    },
    { amr: [null, 1, { methods: "recovery", timestamp: at }, { method: ["recovery"], timestamp: at }] },
    { amr: [{ method: "RECOVERY", timestamp: at }] },
  ]) {
    assert.equal(isRecoverySession(claims, now), false, JSON.stringify(claims));
  }
});
