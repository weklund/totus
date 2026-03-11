// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useConnections } from "../useConnections";
import type { Connection } from "../useConnections";

// Mock api client
vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(),
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

const MOCK_CONNECTIONS: Connection[] = [
  {
    id: "conn-1",
    provider: "oura",
    status: "active",
    last_sync_at: "2026-03-10T12:00:00.000Z",
    sync_status: "idle",
    connected_at: "2026-01-15T10:00:00.000Z",
  },
  {
    id: "conn-2",
    provider: "dexcom",
    status: "expired",
    last_sync_at: null,
    sync_status: "idle",
    connected_at: "2026-02-01T10:00:00.000Z",
  },
];

describe("useConnections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns connections with provider field (not hardcoded oura)", async () => {
    const { api } = await import("@/lib/api-client");
    const mockApi = vi.mocked(api);
    mockApi.get.mockResolvedValue({ data: MOCK_CONNECTIONS });

    const { result } = renderHook(() => useConnections(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const connections = result.current.data?.data;
    expect(connections).toHaveLength(2);
    expect(connections?.[0].provider).toBe("oura");
    expect(connections?.[1].provider).toBe("dexcom");
  });

  it("returns connection objects with correct shape", async () => {
    const { api } = await import("@/lib/api-client");
    const mockApi = vi.mocked(api);
    mockApi.get.mockResolvedValue({ data: MOCK_CONNECTIONS });

    const { result } = renderHook(() => useConnections(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const conn = result.current.data?.data?.[0];
    expect(conn).toHaveProperty("id");
    expect(conn).toHaveProperty("provider");
    expect(conn).toHaveProperty("status");
    expect(conn).toHaveProperty("last_sync_at");
    expect(conn).toHaveProperty("sync_status");
    expect(conn).toHaveProperty("connected_at");
  });

  it("calls GET /connections", async () => {
    const { api } = await import("@/lib/api-client");
    const mockApi = vi.mocked(api);
    mockApi.get.mockResolvedValue({ data: [] });

    const { result } = renderHook(() => useConnections(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockApi.get).toHaveBeenCalledWith("/connections");
  });

  it("handles error state", async () => {
    const { api } = await import("@/lib/api-client");
    const mockApi = vi.mocked(api);
    mockApi.get.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useConnections(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeTruthy();
  });
});
