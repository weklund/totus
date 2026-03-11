/**
 * useTriggerSync — TanStack Query mutation for manually triggering a data sync.
 *
 * Calls POST /api/connections/:id/sync.
 * On success, invalidates connections and health data queries.
 *
 * See: /docs/web-ui-lld.md Section 10.4
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

interface TriggerSyncResponse {
  data: {
    sync_id: string;
    status: string;
    message: string;
    rows_synced: number;
  };
}

export function useTriggerSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (connectionId: string) =>
      api.post<TriggerSyncResponse>(`/connections/${connectionId}/sync`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.connections.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.healthData.all });
    },
  });
}
