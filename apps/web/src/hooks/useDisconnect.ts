/**
 * useDisconnect — TanStack Query mutation for disconnecting a data source.
 *
 * Calls DELETE /api/connections/:id.
 * On success, invalidates connections query cache.
 *
 * See: /docs/web-ui-lld.md Section 10.4
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

interface DisconnectResponse {
  data: {
    id: string;
    provider: string;
    disconnected_at: string;
  };
}

export function useDisconnect() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (connectionId: string) =>
      api.delete<DisconnectResponse>(`/connections/${connectionId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.connections.all });
    },
  });
}
