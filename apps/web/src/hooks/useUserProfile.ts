/**
 * useUserProfile — TanStack Query hook for the current user's profile.
 *
 * Calls GET /api/user/profile.
 *
 * See: /docs/web-ui-lld.md Section 7.7
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export interface UserProfile {
  id: string;
  display_name: string;
  created_at: string;
  stats: {
    total_data_points: number;
    active_shares: number;
    connections: number;
  };
}

export interface UserProfileResponse {
  data: UserProfile;
}

export function useUserProfile() {
  return useQuery({
    queryKey: queryKeys.user.profile(),
    queryFn: () => api.get<UserProfileResponse>("/user/profile"),
  });
}
