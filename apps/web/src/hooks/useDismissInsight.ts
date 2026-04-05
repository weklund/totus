/**
 * useDismissInsight — TanStack Query mutation for dismissing insights.
 *
 * Calls POST /api/insights/:type/:date/dismiss and invalidates the
 * dashboard query cache on success so views refetch without the dismissed insight.
 *
 * See: /docs/dashboard-backend-lld.md §10
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export interface DismissInsightRequest {
  type: string;
  date: string;
}

export interface DismissInsightResponse {
  data: {
    insight_type: string;
    date: string;
    dismissed: boolean;
  };
}

export function useDismissInsight() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ type, date }: DismissInsightRequest) =>
      api.post<DismissInsightResponse>(`/insights/${type}/${date}/dismiss`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}
