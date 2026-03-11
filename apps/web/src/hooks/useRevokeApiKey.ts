/**
 * useRevokeApiKey — TanStack Query mutation for revoking an API key.
 *
 * Calls PATCH /api/keys/:id to revoke the key (sets revoked_at).
 * Revoking is idempotent — revoking an already-revoked key returns 200.
 * Invalidates the API keys list cache on success.
 *
 * See: /docs/cli-mcp-server-lld.md (API Key Management)
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export interface RevokeApiKeyResponse {
  data: {
    id: string;
    revoked_at: string;
  };
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (keyId: string) =>
      api.patch<RevokeApiKeyResponse>(`/keys/${keyId}`, {
        action: "revoke",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.apiKeys.all,
      });
    },
  });
}
