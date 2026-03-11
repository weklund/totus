/**
 * useConnections — TanStack Query hook for fetching user connections.
 *
 * Calls GET /api/connections to get the user's connected data sources
 * with status, last sync time, and sync status.
 *
 * See: /docs/web-ui-lld.md Section 10.4
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export interface Connection {
  id: string;
  provider: "oura";
  status: "connected" | "expired" | "error";
  last_sync_at: string | null;
  sync_status: string;
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
