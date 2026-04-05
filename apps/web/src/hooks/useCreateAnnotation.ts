/**
 * useCreateAnnotation — TanStack Query mutation for creating annotations.
 *
 * Calls POST /api/annotations and invalidates the dashboard and annotation
 * query caches on success.
 *
 * See: /docs/dashboard-backend-lld.md §9
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export interface CreateAnnotationRequest {
  event_type: string;
  label: string;
  note?: string;
  occurred_at: string;
  ended_at?: string;
}

export interface CreateAnnotationResponse {
  data: {
    id: number;
    event_type: string;
    label: string;
    note: string | null;
    occurred_at: string;
    ended_at: string | null;
    created_at: string;
  };
}

export function useCreateAnnotation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateAnnotationRequest) =>
      api.post<CreateAnnotationResponse>("/annotations", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}
