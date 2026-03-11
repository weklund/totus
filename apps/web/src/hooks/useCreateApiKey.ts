/**
 * useCreateApiKey — TanStack Query mutation for creating a new API key.
 *
 * Calls POST /api/keys with name, scopes, and optional expires_in_days.
 * Returns the full key ONCE — it is never shown again.
 * Invalidates the API keys list cache on success.
 *
 * See: /docs/cli-mcp-server-lld.md (API Key Management)
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export interface CreateApiKeyRequest {
  name: string;
  scopes: string[];
  expires_in_days?: number;
}

export interface CreateApiKeyResponse {
  data: {
    id: string;
    name: string;
    key: string; // Full key — shown only once
    short_token: string;
    scopes: string[];
    expires_at: string | null;
    created_at: string;
  };
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateApiKeyRequest) =>
      api.post<CreateApiKeyResponse>("/keys", data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.apiKeys.all,
      });
    },
  });
}
