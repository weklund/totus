// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useApiKeys } from "../useApiKeys";
import { useCreateApiKey } from "../useCreateApiKey";
import { useRevokeApiKey } from "../useRevokeApiKey";

// Mock api client
vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useApiKeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches keys from GET /keys", async () => {
    const { api } = await import("@/lib/api-client");
    const mockApi = vi.mocked(api);
    mockApi.get.mockResolvedValue({
      data: [
        {
          id: "key-1",
          name: "CLI key",
          short_token: "tot_live",
          scopes: ["health:read"],
          expires_at: null,
          last_used_at: null,
          revoked_at: null,
          created_at: "2026-03-10T00:00:00Z",
        },
      ],
    });

    const { result } = renderHook(() => useApiKeys(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockApi.get).toHaveBeenCalledWith("/keys");
    expect(result.current.data?.data).toHaveLength(1);
    expect(result.current.data?.data[0].name).toBe("CLI key");
    expect(result.current.data?.data[0].short_token).toBe("tot_live");
  });

  it("returns empty array when no keys exist", async () => {
    const { api } = await import("@/lib/api-client");
    const mockApi = vi.mocked(api);
    mockApi.get.mockResolvedValue({ data: [] });

    const { result } = renderHook(() => useApiKeys(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.data).toHaveLength(0);
  });

  it("handles error state", async () => {
    const { api } = await import("@/lib/api-client");
    const mockApi = vi.mocked(api);
    mockApi.get.mockRejectedValue(new Error("Unauthorized"));

    const { result } = renderHook(() => useApiKeys(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});

describe("useCreateApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls POST /keys with name and scopes", async () => {
    const { api } = await import("@/lib/api-client");
    const mockApi = vi.mocked(api);
    mockApi.post.mockResolvedValue({
      data: {
        id: "key-new",
        name: "Test key",
        key: "tot_live_abcd1234_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        short_token: "tot_live",
        scopes: ["health:read"],
        expires_at: null,
        created_at: "2026-03-10T00:00:00Z",
      },
    });

    const { result } = renderHook(() => useCreateApiKey(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        name: "Test key",
        scopes: ["health:read"],
      });
    });

    expect(mockApi.post).toHaveBeenCalledWith("/keys", {
      name: "Test key",
      scopes: ["health:read"],
    });
  });
});

describe("useRevokeApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls PATCH /keys/:id with revoke action", async () => {
    const { api } = await import("@/lib/api-client");
    const mockApi = vi.mocked(api);
    mockApi.patch.mockResolvedValue({
      data: {
        id: "key-1",
        revoked_at: "2026-03-10T00:00:00Z",
      },
    });

    const { result } = renderHook(() => useRevokeApiKey(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync("key-1");
    });

    expect(mockApi.patch).toHaveBeenCalledWith("/keys/key-1", {
      action: "revoke",
    });
  });
});
