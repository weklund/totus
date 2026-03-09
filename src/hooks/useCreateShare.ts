/**
 * useCreateShare — TanStack Query mutation for creating share grants.
 *
 * Calls POST /api/shares and invalidates the shares list cache on success.
 *
 * See: /docs/web-ui-lld.md Section 10.4
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export interface CreateShareRequest {
  label: string;
  allowed_metrics: string[];
  data_start: string;
  data_end: string;
  expires_in_days: number;
  note?: string;
}

export interface CreateShareResponse {
  data: {
    id: string;
    token: string;
    share_url: string;
    label: string;
    allowed_metrics: string[];
    data_start: string;
    data_end: string;
    grant_expires: string;
    note: string | null;
    created_at: string;
  };
}

export function useCreateShare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateShareRequest) =>
      api.post<CreateShareResponse>("/shares", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shares.all });
    },
  });
}
