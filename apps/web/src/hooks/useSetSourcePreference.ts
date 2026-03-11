/**
 * useSetSourcePreference — TanStack Query mutation for setting a metric source preference.
 *
 * Calls PUT /api/metric-preferences/:metricType with { provider }.
 * Invalidates the preferences list cache on success.
 *
 * See: /docs/web-ui-lld.md Section 8.5 (SourcePreferenceSelector)
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export interface SetSourcePreferenceRequest {
  metricType: string;
  provider: string;
}

export interface SetSourcePreferenceResponse {
  data: {
    metric_type: string;
    provider: string;
    updated_at: string;
  };
}

export function useSetSourcePreference() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ metricType, provider }: SetSourcePreferenceRequest) =>
      api.put<SetSourcePreferenceResponse>(
        `/metric-preferences/${metricType}`,
        { provider },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.preferences.all,
      });
    },
  });
}
