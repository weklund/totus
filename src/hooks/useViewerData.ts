/**
 * useViewerData — TanStack Query hook for viewer-scoped health data.
 *
 * Same interface as useHealthData but calls GET /api/viewer/data.
 * Used when role='viewer' in ViewContext.
 *
 * See: /docs/web-ui-lld.md Section 10.4
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import type { HealthDataResponse, UseHealthDataParams } from "./useHealthData";

export function useViewerData(params: UseHealthDataParams) {
  return useQuery({
    queryKey: queryKeys.viewerData.list(params),
    queryFn: () => {
      const searchParams = new URLSearchParams({
        metrics: params.metrics.join(","),
        start: params.start,
        end: params.end,
        resolution: params.resolution,
      });
      return api.get<HealthDataResponse>(
        `/viewer/data?${searchParams.toString()}`,
      );
    },
    enabled: params.metrics.length > 0,
    staleTime: 2 * 60 * 1000,
  });
}
