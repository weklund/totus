/**
 * useSeriesData — TanStack Query hook for fetching intraday series data.
 *
 * Calls GET /api/health-data/series for a single metric type (e.g., heart_rate, glucose).
 * Returns high-frequency readings with timestamps.
 *
 * See: /docs/web-ui-lld.md Section 10.4
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export interface SeriesReading {
  recorded_at: string;
  value: number;
}

export interface SeriesDataResponse {
  data: {
    metric_type: string;
    source: string;
    readings: SeriesReading[];
  };
}

export interface UseSeriesDataParams {
  metric_type: string;
  from: string;
  to: string;
  source?: string;
}

export function useSeriesData(params: UseSeriesDataParams) {
  return useQuery({
    queryKey: queryKeys.healthData.series(params),
    queryFn: () => {
      const searchParams = new URLSearchParams({
        metric_type: params.metric_type,
        from: params.from,
        to: params.to,
      });
      if (params.source) searchParams.set("source", params.source);
      return api.get<SeriesDataResponse>(
        `/health-data/series?${searchParams.toString()}`,
      );
    },
    enabled: !!params.metric_type,
    staleTime: 2 * 60 * 1000,
  });
}
