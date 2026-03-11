/**
 * useSourcePreferences — TanStack Query hook for fetching metric source preferences.
 *
 * Calls GET /api/metric-preferences to get the user's per-metric provider preferences.
 * Returns an array of preferences, each with metric_type and provider.
 *
 * See: /docs/web-ui-lld.md Section 8.5 (SourcePreferenceSelector)
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export interface SourcePreference {
  metric_type: string;
  provider: string;
  updated_at: string;
}

export interface SourcePreferencesResponse {
  data: {
    preferences: SourcePreference[];
  };
}

export function useSourcePreferences() {
  return useQuery({
    queryKey: queryKeys.preferences.list(),
    queryFn: () => api.get<SourcePreferencesResponse>("/metric-preferences"),
    staleTime: 60 * 1000,
  });
}
