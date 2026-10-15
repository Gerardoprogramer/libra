import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { getSupabaseConfig } from "./config";

function setEnvironment(t: TestContext, values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("L13: both public Supabase settings are returned when configured", (t) => {
  setEnvironment(t, {
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
  });

  assert.deepEqual(getSupabaseConfig(), {
    url: "https://project.supabase.co",
    publishableKey: "sb_publishable_example",
  });
});

test("L13: a missing setting fails with a message that names the variables and never a value", (t) => {
  setEnvironment(t, {
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
  });

  assert.throws(
    () => getSupabaseConfig(),
    (error: Error) =>
      /NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/.test(error.message) &&
      !error.message.includes("project.supabase.co"),
  );

  setEnvironment(t, { NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "key" });
  assert.throws(() => getSupabaseConfig(), /must both be set/);
});
