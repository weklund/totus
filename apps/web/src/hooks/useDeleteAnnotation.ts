/**
 * useDeleteAnnotation — TanStack Query mutation for deleting annotations.
 *
 * Calls DELETE /api/annotations/:id and invalidates the dashboard and
 * annotation query caches on success.
 *
 * See: /docs/dashboard-backend-lld.md §9
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export interface DeleteAnnotationResponse {
  data: {
    id: number;
    deleted: boolean;
  };
}

export function useDeleteAnnotation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (annotationId: number) =>
      api.delete<DeleteAnnotationResponse>(`/annotations/${annotationId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}
