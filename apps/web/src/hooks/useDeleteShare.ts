/**
 * useDeleteShare — TanStack Query mutation for hard-deleting share grants.
 *
 * Calls DELETE /api/shares/:id. Only available for revoked/expired shares.
 * Invalidates the shares list cache on success.
 *
 * See: /docs/web-ui-lld.md Section 10.4
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export function useDeleteShare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shareId: string) => api.delete(`/shares/${shareId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shares.all });
    },
  });
}
