import assert from "node:assert/strict";
import { test } from "node:test";

import { passwordUpdateMessageKey, signInMessageKey, signUpMessageKey } from "./auth-errors";

test("L15: a wrong password and an unconfirmed email are told apart from every other sign-in failure", () => {
  assert.equal(signInMessageKey({ code: "invalid_credentials" }), "invalidCredentials");
  assert.equal(signInMessageKey({ code: "email_not_confirmed" }), "emailNotConfirmed");
  for (const error of [{ code: "over_request_rate_limit" }, { code: "unexpected_failure" }, {}, null, undefined]) {
    assert.equal(signInMessageKey(error), "genericError");
  }
});

test("L15: sign-up and password changes only distinguish a weak password; account existence is never revealed", () => {
  assert.equal(signUpMessageKey({ code: "weak_password" }), "weakPassword");
  assert.equal(passwordUpdateMessageKey({ code: "weak_password" }), "weakPassword");
  for (const code of ["user_already_exists", "email_exists", "over_email_send_rate_limit", undefined]) {
    assert.equal(signUpMessageKey({ code }), "genericError");
    assert.equal(passwordUpdateMessageKey({ code }), "genericError");
  }
});
