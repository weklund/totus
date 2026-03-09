/**
 * useRevokeShare — TanStack Query mutation for revoking share grants.
 *
 * Calls PATCH /api/shares/:id with action "revoke".
 * Implements optimistic update with rollback on error.
 *
 * See: /docs/web-ui-lld.md Section 10.4
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export function useRevokeShare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shareId: string) =>
      api.patch(`/shares/${shareId}`, { action: "revoke" }),
    onMutate: async (shareId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.shares.all });

      // Snapshot current data for rollback
      const previousShares = queryClient.getQueriesData({
        queryKey: queryKeys.shares.all,
      });

      // Optimistically update: mark the share as revoked
      queryClient.setQueriesData(
        { queryKey: queryKeys.shares.all },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (old: any) => {
          if (!old?.pages) return old;
          return {
            ...old,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            pages: old.pages.map((page: any) => ({
              ...page,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              data: page.data.map((share: any) =>
                share.id === shareId
                  ? {
                      ...share,
                      status: "revoked",
                      revoked_at: new Date().toISOString(),
                    }
                  : share,
              ),
            })),
          };
        },
      );

      return { previousShares };
    },
    onError: (_err, _shareId, context) => {
      // Rollback on error
      if (context?.previousShares) {
        for (const [key, data] of context.previousShares) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      // Refetch to ensure server state consistency
      queryClient.invalidateQueries({ queryKey: queryKeys.shares.all });
    },
  });
}
