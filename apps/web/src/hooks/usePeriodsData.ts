/**
 * usePeriodsData — TanStack Query hook for fetching duration events.
 *
 * Calls GET /api/health-data/periods for a single event type
 * (e.g., sleep_stage, workout, meal). Returns period events with
 * start/end times and durations.
 *
 * See: /docs/web-ui-lld.md Section 10.4
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export interface PeriodEvent {
  subtype: string;
  started_at: string;
  ended_at: string;
  duration_sec: number;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface PeriodsDataResponse {
  data: {
    event_type: string;
    periods: PeriodEvent[];
  };
}

export interface UsePeriodsDataParams {
  event_type: string;
  from: string;
  to: string;
  source?: string;
}

export function usePeriodsData(params: UsePeriodsDataParams) {
  return useQuery({
    queryKey: queryKeys.healthData.periods(params),
    queryFn: () => {
      const searchParams = new URLSearchParams({
        event_type: params.event_type,
        from: params.from,
        to: params.to,
      });
      if (params.source) searchParams.set("source", params.source);
      return api.get<PeriodsDataResponse>(
        `/health-data/periods?${searchParams.toString()}`,
      );
    },
    enabled: !!params.event_type,
    staleTime: 2 * 60 * 1000,
  });
}
