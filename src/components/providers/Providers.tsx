"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ToastProvider } from "@/components/ui/Toast";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000, // data is "fresh" for 60s
            gcTime: 5 * 60_000, // keep unused cache 5 min so revisits render instantly
            // refetchOnMount stays at its default (true): cached data renders INSTANTLY on
            // revisit (it doesn't block — only background-refetches when the entry is stale
            // >60s or was invalidated). This is required for correctness: a cross-screen
            // invalidation (e.g. a QC submit hiding a lot on the Dyeing Queue / Program
            // Cards, which are unmounted at the time) only refetches when those screens
            // next mount. We only suppress the window-focus / reconnect refetch storms.
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
