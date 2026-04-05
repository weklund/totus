/**
 * useTrendView — TanStack Query hook for fetching the 30-Day Trend view.
 *
 * Calls GET /api/views/trend to get trend data including raw values,
 * rolling averages, trend analysis, baselines, and correlations.
 *
 * See: /docs/dashboard-backend-lld.md §8.3
 */

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import type {
  CorrelationResult,
  Insight,
  TrendResult,
} from "@/lib/dashboard/types";

export interface TrendViewBaseline {
  avg: number;
  stddev: number;
  upper: number;
  lower: number;
  sample_count?: number;
}

export interface TrendMetricData {
  raw: {
    dates: string[];
    values: number[];
  };
  smoothed: {
    dates: string[];
    values: number[];
  } | null;
  trend: TrendResult;
  baseline: TrendViewBaseline | null;
}

export interface TrendViewResponse {
  data: {
    date_range: {
      start: string;
      end: string;
    };
    smoothing: string;
    insights: Insight[];
    metrics: Record<string, TrendMetricData>;
    correlations: CorrelationResult[];
  };
}

export function useTrendView(
  start: string,
  end: string,
  metrics: string,
  smoothing?: string,
  options?: Omit<
    UseQueryOptions<TrendViewResponse, Error>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: queryKeys.dashboard.trend({ start, end, metrics, smoothing }),
    queryFn: () => {
      const searchParams = new URLSearchParams({ start, end, metrics });
      if (smoothing) searchParams.set("smoothing", smoothing);
      return api.get<TrendViewResponse>(
        `/views/trend?${searchParams.toString()}`,
      );
    },
    enabled: !!start && !!end && !!metrics,
    staleTime: 2 * 60 * 1000,
    ...options,
  });
}
