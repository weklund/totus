/**
 * useAnnotations — TanStack Query hook for fetching annotations.
 *
 * Calls GET /api/annotations with date range and optional event type filter.
 * Returns merged user annotations and provider-sourced events.
 *
 * See: /docs/dashboard-backend-lld.md §9
 */

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import type { Annotation } from "@/lib/dashboard/types";

export interface AnnotationsResponse {
  data: {
    annotations: Annotation[];
  };
}

export function useAnnotations(
  start: string,
  end: string,
  eventType?: string,
  options?: Omit<
    UseQueryOptions<AnnotationsResponse, Error>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: queryKeys.dashboard.annotations({
      start,
      end,
      event_type: eventType,
    }),
    queryFn: () => {
      const searchParams = new URLSearchParams({ start, end });
      if (eventType) searchParams.set("event_type", eventType);
      return api.get<AnnotationsResponse>(
        `/annotations?${searchParams.toString()}`,
      );
    },
    enabled: !!start && !!end,
    staleTime: 2 * 60 * 1000,
    ...options,
  });
}
