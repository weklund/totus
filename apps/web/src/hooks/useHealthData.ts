/**
 * useHealthData — TanStack Query hook for fetching health metric data.
 *
 * Calls GET /api/health-data with metrics, date range, and resolution.
 * Returns decrypted data points grouped by metric type.
 *
 * See: /docs/web-ui-lld.md Section 10.4
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export interface HealthDataPoint {
  date: string;
  value: number;
  source: string;
}

export interface HealthDataMetric {
  unit: string;
  points: HealthDataPoint[];
}

export interface HealthDataResponse {
  data: {
    metrics: Record<string, HealthDataMetric>;
    query: {
      start: string;
      end: string;
      resolution: string;
      metrics_requested: string[];
      metrics_returned: string[];
    };
  };
}

export interface UseHealthDataParams {
  metrics: string[];
  start: string;
  end: string;
  resolution: "daily" | "weekly" | "monthly";
}

export function useHealthData(params: UseHealthDataParams) {
  return useQuery({
    queryKey: queryKeys.healthData.list(params),
    queryFn: () => {
      const searchParams = new URLSearchParams({
        metrics: params.metrics.join(","),
        start: params.start,
        end: params.end,
        resolution: params.resolution,
      });
      return api.get<HealthDataResponse>(
        `/health-data?${searchParams.toString()}`,
      );
    },
    enabled: params.metrics.length > 0,
    staleTime: 2 * 60 * 1000,
  });
}
