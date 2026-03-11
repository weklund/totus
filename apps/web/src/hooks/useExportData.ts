/**
 * useExportData — TanStack Query mutation for exporting all user data.
 *
 * Calls POST /api/user/export and returns the export payload.
 *
 * See: /docs/web-ui-lld.md Section 7.7
 */

import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export interface ExportDataResponse {
  data: {
    export: Record<string, unknown>;
  };
}

export function useExportData() {
  return useMutation({
    mutationFn: () => api.post<ExportDataResponse>("/user/export", {}),
  });
}
