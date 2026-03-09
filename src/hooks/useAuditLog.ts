/**
 * useAuditLog — TanStack Query hook for paginated, filterable audit events.
 *
 * Calls GET /api/audit with optional filters and cursor pagination.
 * Uses useInfiniteQuery for "Load More" pattern.
 *
 * See: /docs/web-ui-lld.md Section 7.6
 */

import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export interface AuditEvent {
  id: string;
  event_type: string;
  actor_type: "owner" | "viewer" | "system";
  actor_id: string | null;
  grant_id: string | null;
  resource_type: string;
  resource_detail: Record<string, unknown> | null;
  description: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AuditResponse {
  data: AuditEvent[];
  pagination: {
    next_cursor: string | null;
    has_more: boolean;
  };
}

export interface AuditFilters {
  eventType?: string;
  actorType?: string;
  start?: string;
  end?: string;
}

export function useAuditLog(filters?: AuditFilters) {
  const filterRecord: Record<string, string> = {};
  if (filters?.eventType) filterRecord.eventType = filters.eventType;
  if (filters?.actorType) filterRecord.actorType = filters.actorType;
  if (filters?.start) filterRecord.start = filters.start;
  if (filters?.end) filterRecord.end = filters.end;

  return useInfiniteQuery({
    queryKey: queryKeys.audit.list(
      Object.keys(filterRecord).length > 0 ? filterRecord : undefined,
    ),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (filters?.eventType) params.set("event_type", filters.eventType);
      if (filters?.actorType) params.set("actor_type", filters.actorType);
      if (filters?.start) params.set("start", filters.start);
      if (filters?.end) params.set("end", filters.end);
      if (pageParam) params.set("cursor", pageParam);
      params.set("limit", "50");
      const qs = params.toString();
      return api.get<AuditResponse>(`/audit${qs ? `?${qs}` : ""}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.has_more
        ? (lastPage.pagination.next_cursor ?? undefined)
        : undefined,
  });
}
