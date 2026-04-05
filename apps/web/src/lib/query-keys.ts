/**
 * TanStack Query key factory — centralized query key management.
 *
 * Ensures consistent cache key structure across all hooks.
 */

export const queryKeys = {
  healthData: {
    all: ["health-data"] as const,
    list: (params: {
      metrics: string[];
      start: string;
      end: string;
      resolution: string;
    }) => ["health-data", "list", params] as const,
    types: () => ["health-data", "types"] as const,
    series: (params: {
      metric_type: string;
      from: string;
      to: string;
      source?: string;
    }) => ["health-data", "series", params] as const,
    periods: (params: {
      event_type: string;
      from: string;
      to: string;
      source?: string;
    }) => ["health-data", "periods", params] as const,
  },
  viewerData: {
    all: ["viewer-data"] as const,
    list: (params: {
      metrics: string[];
      start: string;
      end: string;
      resolution: string;
    }) => ["viewer-data", "list", params] as const,
  },
  connections: {
    all: ["connections"] as const,
    list: () => ["connections", "list"] as const,
  },
  shares: {
    all: ["shares"] as const,
    list: (status?: string) => ["shares", "list", status] as const,
    detail: (id: string) => ["shares", "detail", id] as const,
  },
  audit: {
    all: ["audit"] as const,
    list: (filters?: Record<string, string>) =>
      ["audit", "list", filters] as const,
  },
  user: {
    all: ["user"] as const,
    profile: () => ["user", "profile"] as const,
  },
  preferences: {
    all: ["preferences"] as const,
    list: () => ["preferences", "list"] as const,
  },
  apiKeys: {
    all: ["api-keys"] as const,
    list: () => ["api-keys", "list"] as const,
  },
  dashboard: {
    all: ["dashboard"] as const,
    night: (date: string) => ["dashboard", "night", date] as const,
    recovery: (params: {
      start: string;
      end: string;
      metrics?: string;
      event_id?: string;
    }) => ["dashboard", "recovery", params] as const,
    trend: (params: {
      start: string;
      end: string;
      metrics: string;
      smoothing?: string;
    }) => ["dashboard", "trend", params] as const,
    annotations: (params: {
      start: string;
      end: string;
      event_type?: string;
    }) => ["dashboard", "annotations", params] as const,
  },
};
