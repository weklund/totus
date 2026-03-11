/**
 * useHealthDataTypes — TanStack Query hook for available metric types.
 *
 * Calls GET /api/health-data/types to discover which metrics the user
 * has data for, along with date ranges and point counts.
 *
 * See: /docs/web-ui-lld.md Section 10.4
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export interface HealthDataType {
  metric_type: string;
  label: string;
  unit: string;
  category: string;
  source: string;
  date_range: {
    start: string;
    end: string;
  };
  count: number;
}

export interface HealthDataTypesResponse {
  data: {
    types: HealthDataType[];
  };
}

export function useHealthDataTypes() {
  return useQuery({
    queryKey: queryKeys.healthData.types(),
    queryFn: () => api.get<HealthDataTypesResponse>("/health-data/types"),
    staleTime: 5 * 60 * 1000,
  });
}
