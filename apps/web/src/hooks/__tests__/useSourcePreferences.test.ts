// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useSourcePreferences } from "../useSourcePreferences";

// Mock api client
vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useSourcePreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches preferences from GET /metric-preferences", async () => {
    const { api } = await import("@/lib/api-client");
    const mockApi = vi.mocked(api);
    mockApi.get.mockResolvedValue({
      data: {
        preferences: [
          {
            metric_type: "hrv",
            provider: "oura",
            updated_at: "2026-03-10T00:00:00Z",
          },
        ],
      },
    });

    const { result } = renderHook(() => useSourcePreferences(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockApi.get).toHaveBeenCalledWith("/metric-preferences");
    expect(result.current.data?.data?.preferences).toHaveLength(1);
    expect(result.current.data?.data?.preferences[0].metric_type).toBe("hrv");
    expect(result.current.data?.data?.preferences[0].provider).toBe("oura");
  });

  it("handles empty preferences", async () => {
    const { api } = await import("@/lib/api-client");
    const mockApi = vi.mocked(api);
    mockApi.get.mockResolvedValue({
      data: { preferences: [] },
    });

    const { result } = renderHook(() => useSourcePreferences(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.data?.preferences).toHaveLength(0);
  });

  it("handles error state", async () => {
    const { api } = await import("@/lib/api-client");
    const mockApi = vi.mocked(api);
    mockApi.get.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useSourcePreferences(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeTruthy();
  });
});
