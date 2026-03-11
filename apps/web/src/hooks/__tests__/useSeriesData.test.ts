// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useSeriesData } from "../useSeriesData";

// Mock api-client
vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from "@/lib/api-client";

const MOCK_SERIES_RESPONSE = {
  data: {
    metric_type: "heart_rate",
    source: "oura",
    readings: [
      { recorded_at: "2026-01-01T08:00:00Z", value: 72 },
      { recorded_at: "2026-01-01T08:05:00Z", value: 75 },
      { recorded_at: "2026-01-01T08:10:00Z", value: 68 },
    ],
  },
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useSeriesData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches series data with correct URL params", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_SERIES_RESPONSE);

    const { result } = renderHook(
      () =>
        useSeriesData({
          metric_type: "heart_rate",
          from: "2026-01-01",
          to: "2026-01-31",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.get).toHaveBeenCalledWith(
      "/health-data/series?metric_type=heart_rate&from=2026-01-01&to=2026-01-31",
    );
    expect(result.current.data).toEqual(MOCK_SERIES_RESPONSE);
  });

  it("includes source param when provided", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_SERIES_RESPONSE);

    const { result } = renderHook(
      () =>
        useSeriesData({
          metric_type: "heart_rate",
          from: "2026-01-01",
          to: "2026-01-31",
          source: "oura",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.get).toHaveBeenCalledWith(
      "/health-data/series?metric_type=heart_rate&from=2026-01-01&to=2026-01-31&source=oura",
    );
  });

  it("is disabled when metric_type is empty", async () => {
    const { result } = renderHook(
      () =>
        useSeriesData({
          metric_type: "",
          from: "2026-01-01",
          to: "2026-01-31",
        }),
      { wrapper: createWrapper() },
    );

    // Should not fetch
    expect(result.current.fetchStatus).toBe("idle");
    expect(api.get).not.toHaveBeenCalled();
  });
});
