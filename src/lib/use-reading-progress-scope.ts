"use client";

import { useEffect, useState } from "react";

import type { ReadingProgressScope } from "@/lib/reading-progress";
import { createClient } from "@/lib/supabase/client";

export function useReadingProgressScope(): ReadingProgressScope | null {
  const [scope, setScope] = useState<ReadingProgressScope | null>(null);

  useEffect(() => {
    let mounted = true;
    let authVersion = 0;

    const supabase = createClient();

    async function resolveScope() {
      const version = ++authVersion;

      const { data, error } = await supabase.auth.getClaims();

      if (!mounted || version !== authVersion) {
        return;
      }

      const userId = !error && typeof data?.claims?.sub === "string" ? data.claims.sub : null;

      setScope(
        userId
          ? {
              type: "user",
              userId,
            }
          : {
              type: "guest",
            },
      );
    }

    void resolveScope();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      authVersion += 1;

      if (!mounted) {
        return;
      }

      const userId = session?.user?.id ?? null;

      setScope(
        userId
          ? {
              type: "user",
              userId,
            }
          : {
              type: "guest",
            },
      );
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return scope;
}
