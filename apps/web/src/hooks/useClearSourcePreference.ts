/**
 * useClearSourcePreference — TanStack Query mutation for clearing a metric source preference.
 *
 * Calls DELETE /api/metric-preferences/:metricType.
 * Invalidates the preferences list cache on success.
 *
 * See: /docs/web-ui-lld.md Section 8.5 (SourcePreferenceSelector)
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export interface ClearSourcePreferenceResponse {
  data: {
    metric_type: string;
    deleted: boolean;
  };
}

export function useClearSourcePreference() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (metricType: string) =>
      api.delete<ClearSourcePreferenceResponse>(
        `/metric-preferences/${metricType}`,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.preferences.all,
      });
    },
  });
}
