/**
 * useConnections — TanStack Query hook for fetching user connections.
 *
 * Calls GET /api/connections to get the user's connected data sources
 * with status, last sync time, and sync status.
 *
 * Supports multiple providers (oura, dexcom, garmin, whoop, withings, cronometer, nutrisense).
 *
 * See: /docs/web-ui-lld.md Section 10.4
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import type { ProviderId } from "@/config/providers";

export interface Connection {
  id: string;
  provider: ProviderId;
  status: "active" | "expired" | "error" | "paused";
  last_sync_at: string | null;
  sync_status: "idle" | "queued" | "syncing" | "error";
  connected_at: string;
}

export interface ConnectionsResponse {
  data: Connection[];
}

export function useConnections() {
  return useQuery({
    queryKey: queryKeys.connections.list(),
    queryFn: () => api.get<ConnectionsResponse>("/connections"),
    staleTime: 60 * 1000,
  });
}
