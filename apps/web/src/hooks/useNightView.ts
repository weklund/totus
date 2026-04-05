/**
 * useNightView — TanStack Query hook for fetching the Night Detail view.
 *
 * Calls GET /api/views/night?date=... to get the complete night view
 * including intraday series, hypnogram, summary, baselines, annotations, and insights.
 *
 * See: /docs/dashboard-backend-lld.md §8.1
 */

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import type {
  Annotation,
  BaselinePayload,
  Insight,
  SummaryMetric,
} from "@/lib/dashboard/types";

export interface NightViewSeries {
  timestamps: string[];
  values: number[];
}

export interface NightViewResponse {
  data: {
    date: string;
    time_range: {
      start: string;
      end: string;
    };
    insights: Insight[];
    annotations: Annotation[];
    series: Record<string, NightViewSeries>;
    hypnogram: Array<{
      stage: string;
      start: string;
      end: string;
    }>;
    summary: Record<string, SummaryMetric>;
    baselines: Record<string, BaselinePayload>;
  };
}

export function useNightView(
  date: string,
  options?: Omit<
    UseQueryOptions<NightViewResponse, Error>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: queryKeys.dashboard.night(date),
    queryFn: () => {
      const searchParams = new URLSearchParams({ date });
      return api.get<NightViewResponse>(
        `/views/night?${searchParams.toString()}`,
      );
    },
    enabled: !!date,
    staleTime: 2 * 60 * 1000,
    ...options,
  });
}
