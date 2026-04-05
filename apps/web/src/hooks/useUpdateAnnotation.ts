/**
 * useUpdateAnnotation — TanStack Query mutation for updating annotations.
 *
 * Calls PATCH /api/annotations/:id and invalidates the dashboard and
 * annotation query caches on success.
 *
 * See: /docs/dashboard-backend-lld.md §9
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export interface UpdateAnnotationRequest {
  id: number;
  label?: string;
  note?: string | null;
  occurred_at?: string;
  ended_at?: string | null;
}

export interface UpdateAnnotationResponse {
  data: {
    id: number;
    event_type: string;
    label: string;
    note: string | null;
    occurred_at: string;
    ended_at: string | null;
    created_at: string;
    updated_at: string;
  };
}

export function useUpdateAnnotation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: UpdateAnnotationRequest) =>
      api.patch<UpdateAnnotationResponse>(`/annotations/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}
