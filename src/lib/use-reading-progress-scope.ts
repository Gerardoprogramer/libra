"use client";

import { useMemo, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ReadingProgressScope } from "@/lib/reading-progress";

// A UI partition, not an authorization check. RLS / Route Handlers authorize data.
// INITIAL_SESSION reads local cookies, so guests do not wait on getClaims().
function createScopeStore() {
  let scope: ReadingProgressScope | null = null;
  return {
    getSnapshot: () => scope,
    subscribe(notify: () => void) {
      const {
        data: { subscription },
      } = createClient().auth.onAuthStateChange((_event, session) => {
        const userId = session?.user.id;
        if (userId ? scope?.type === "user" && scope.userId === userId : scope?.type === "guest") return;
        scope = userId ? { type: "user", userId } : { type: "guest" };
        notify();
      });
      return () => subscription.unsubscribe();
    },
  };
}

const getServerSnapshot = () => null;

export function useReadingProgressScope(): ReadingProgressScope | null {
  const pathname = usePathname();
  // Server logout updates cookies without emitting a browser auth event. A new
  // route must resolve them again, hiding the previous identity in the meantime.
  const store = useMemo(() => ({ pathname, ...createScopeStore() }), [pathname]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, getServerSnapshot);
}
