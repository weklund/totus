"use client";

import { useEffect, useRef, useState } from "react";
import { ViewContextProvider } from "@/lib/view-context";
import { ShareExpiredPage } from "./ShareExpiredPage";
import { ViewerLayout } from "./ViewerLayout";
import type { ViewContextValue } from "@/types/view-context";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";

interface ViewerGrant {
  valid: boolean;
  owner_display_name: string;
  label: string;
  note: string | null;
  allowed_metrics: string[];
  data_start: string;
  data_end: string;
  expires_at: string;
}

interface ViewerPageClientProps {
  /** Raw share token to re-validate client-side for cookie */
  token: string;
  /** Grant data from server-side validation (for immediate rendering) */
  serverGrant: ViewerGrant;
}

/**
 * ViewerPageClient — client component that:
 * 1. Calls POST /api/viewer/validate from the browser (sets httpOnly cookie)
 * 2. Once cookie is set, renders the viewer dashboard with data fetching
 *
 * See: /docs/web-ui-lld.md Section 7.8
 */
export function ViewerPageClient({
  token,
  serverGrant,
}: ViewerPageClientProps) {
  const [cookieReady, setCookieReady] = useState(false);
  const [error, setError] = useState(false);
  const queryClientRef = useRef<QueryClient | null>(null);

  if (!queryClientRef.current) {
    queryClientRef.current = new QueryClient({
      defaultOptions: {
        queries: {
          retry: 1,
          staleTime: 2 * 60 * 1000,
        },
      },
    });
  }

  // Call validate from the browser to set the viewer cookie
  useEffect(() => {
    async function validateToken() {
      try {
        const res = await fetch("/api/viewer/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
          credentials: "include",
        });

        if (!res.ok) {
          setError(true);
          return;
        }

        setCookieReady(true);
      } catch {
        setError(true);
      }
    }

    validateToken();
  }, [token]);

  if (error) {
    return <ShareExpiredPage />;
  }

  const viewContext: ViewContextValue = {
    role: "viewer",
    permissions: {
      metrics: serverGrant.allowed_metrics,
      dataStart: serverGrant.data_start,
      dataEnd: serverGrant.data_end,
    },
    ownerDisplayName: serverGrant.owner_display_name,
    note: serverGrant.note ?? undefined,
  };

  return (
    <QueryClientProvider client={queryClientRef.current}>
      <ViewContextProvider value={viewContext}>
        {cookieReady ? (
          <ViewerLayoutWithRefetch />
        ) : (
          <ViewerLoadingLayout
            ownerDisplayName={serverGrant.owner_display_name}
            note={serverGrant.note}
          />
        )}
      </ViewContextProvider>
    </QueryClientProvider>
  );
}

/**
 * Renders the ViewerLayout and invalidates all queries to force refetch
 * after the viewer cookie has been set.
 */
function ViewerLayoutWithRefetch() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Invalidate all queries so they refetch with the viewer cookie
    queryClient.invalidateQueries();
  }, [queryClient]);

  return <ViewerLayout />;
}

/**
 * Shows a loading state while the viewer cookie is being set.
 * Renders the header and banner immediately.
 */
function ViewerLoadingLayout({
  ownerDisplayName,
  note,
}: {
  ownerDisplayName: string;
  note: string | null;
}) {
  return (
    <div className="flex min-h-screen flex-col" data-testid="viewer-layout">
      <header className="flex min-h-14 items-center border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold">Totus</span>
          <span className="text-muted-foreground text-sm">
            Shared by {ownerDisplayName ?? "Unknown"}
          </span>
        </div>
        {note && (
          <p className="text-muted-foreground ml-4 text-xs italic">{note}</p>
        )}
      </header>
      <main className="flex-1 p-6">
        <div className="flex items-center justify-center py-16">
          <p className="text-muted-foreground text-sm">Loading shared data…</p>
        </div>
      </main>
    </div>
  );
}
