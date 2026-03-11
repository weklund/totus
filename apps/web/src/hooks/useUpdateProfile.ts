/**
 * useUpdateProfile — TanStack Query mutation for updating the user's display name.
 *
 * Calls PATCH /api/user/profile and invalidates the profile cache on success.
 *
 * See: /docs/web-ui-lld.md Section 7.7
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export interface UpdateProfileRequest {
  display_name: string;
}

export interface UpdateProfileResponse {
  data: {
    id: string;
    display_name: string;
    updated_at: string;
  };
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateProfileRequest) =>
      api.patch<UpdateProfileResponse>("/user/profile", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.user.all });
    },
  });
}
