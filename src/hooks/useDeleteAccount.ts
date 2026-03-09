/**
 * useDeleteAccount — TanStack Query mutation for deleting the user's account.
 *
 * Calls DELETE /api/user/account with the confirmation string.
 *
 * See: /docs/web-ui-lld.md Section 7.7
 */

import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export interface DeleteAccountResponse {
  data: {
    deleted: boolean;
  };
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: (confirmation: string) =>
      api.delete<DeleteAccountResponse>("/user/account", { confirmation }),
  });
}
