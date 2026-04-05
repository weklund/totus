/**
 * useRecoveryView — TanStack Query hook for fetching the Multi-Day Recovery view.
 *
 * Calls GET /api/views/recovery to get recovery arc data including
 * daily metrics, sparklines, baselines, annotations, and insights.
 *
 * See: /docs/dashboard-backend-lld.md §8.2
 */

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import type { Annotation, Insight, SummaryMetric } from "@/lib/dashboard/types";

export interface RecoveryDailyEntry {
  metrics: Record<string, SummaryMetric>;
}

export interface RecoveryViewBaseline {
  avg: number;
  stddev: number;
  upper: number;
  lower: number;
}

export interface RecoveryViewResponse {
  data: {
    date_range: {
      start: string;
      end: string;
    };
    triggering_event: Annotation | null;
    insights: Insight[];
    daily: Record<string, RecoveryDailyEntry>;
    baselines: Record<string, RecoveryViewBaseline>;
    sparklines: Record<string, { dates: string[]; values: number[] }>;
    annotations: Annotation[];
  };
}

export function useRecoveryView(
  start: string,
  end: string,
  metrics?: string,
  eventId?: string,
  options?: Omit<
    UseQueryOptions<RecoveryViewResponse, Error>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: queryKeys.dashboard.recovery({
      start,
      end,
      metrics,
      event_id: eventId,
    }),
    queryFn: () => {
      const searchParams = new URLSearchParams({ start, end });
      if (metrics) searchParams.set("metrics", metrics);
      if (eventId) searchParams.set("event_id", eventId);
      return api.get<RecoveryViewResponse>(
        `/views/recovery?${searchParams.toString()}`,
      );
    },
    enabled: !!start && !!end,
    staleTime: 2 * 60 * 1000,
    ...options,
  });
}
