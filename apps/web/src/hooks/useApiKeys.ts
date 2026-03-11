/**
 * useApiKeys — TanStack Query hook for fetching API keys.
 *
 * Calls GET /api/keys to list the user's API keys.
 * Returns masked keys only (full key is never returned from list endpoint).
 *
 * See: /docs/cli-mcp-server-lld.md (API Key Management)
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export interface ApiKey {
  id: string;
  name: string;
  short_token: string;
  scopes: string[];
  status: "active" | "expired" | "revoked";
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface ApiKeysResponse {
  data: ApiKey[];
}

export function useApiKeys() {
  return useQuery({
    queryKey: queryKeys.apiKeys.list(),
    queryFn: () => api.get<ApiKeysResponse>("/keys"),
    staleTime: 30 * 1000,
  });
}
