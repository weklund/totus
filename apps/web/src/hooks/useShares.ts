/**
 * useShares — TanStack Query hook for paginated share grants list.
 *
 * Calls GET /api/shares with optional status filter and cursor pagination.
 * Uses useInfiniteQuery for "Load More" pattern.
 *
 * See: /docs/web-ui-lld.md Section 10.4
 */

import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export interface ShareGrant {
  id: string;
  label: string;
  allowed_metrics: string[];
  data_start: string;
  data_end: string;
  grant_expires: string;
  status: "active" | "expired" | "revoked";
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  note: string | null;
  created_at: string;
}

export interface SharesResponse {
  data: ShareGrant[];
  pagination: {
    next_cursor: string | null;
    has_more: boolean;
  };
}

export function useShares(status?: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.shares.list(status),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (status && status !== "all") params.set("status", status);
      if (pageParam) params.set("cursor", pageParam);
      params.set("limit", "20");
      return api.get<SharesResponse>(`/shares?${params.toString()}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.has_more
        ? (lastPage.pagination.next_cursor ?? undefined)
        : undefined,
  });
}
