// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { usePeriodsData } from "../usePeriodsData";

// Mock api-client
vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from "@/lib/api-client";

const MOCK_PERIODS_RESPONSE = {
  data: {
    event_type: "sleep_stage",
    periods: [
      {
        subtype: "deep",
        started_at: "2026-01-01T23:00:00Z",
        ended_at: "2026-01-01T23:45:00Z",
        duration_sec: 2700,
        source: "oura",
      },
      {
        subtype: "rem",
        started_at: "2026-01-01T23:45:00Z",
        ended_at: "2026-01-02T00:30:00Z",
        duration_sec: 2700,
        source: "oura",
      },
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

describe("usePeriodsData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches periods data with correct URL params", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_PERIODS_RESPONSE);

    const { result } = renderHook(
      () =>
        usePeriodsData({
          event_type: "sleep_stage",
          from: "2026-01-01",
          to: "2026-01-31",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.get).toHaveBeenCalledWith(
      "/health-data/periods?event_type=sleep_stage&from=2026-01-01&to=2026-01-31",
    );
    expect(result.current.data).toEqual(MOCK_PERIODS_RESPONSE);
  });

  it("includes source param when provided", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_PERIODS_RESPONSE);

    const { result } = renderHook(
      () =>
        usePeriodsData({
          event_type: "workout",
          from: "2026-01-01",
          to: "2026-01-31",
          source: "garmin",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.get).toHaveBeenCalledWith(
      "/health-data/periods?event_type=workout&from=2026-01-01&to=2026-01-31&source=garmin",
    );
  });

  it("is disabled when event_type is empty", async () => {
    const { result } = renderHook(
      () =>
        usePeriodsData({
          event_type: "",
          from: "2026-01-01",
          to: "2026-01-31",
        }),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(api.get).not.toHaveBeenCalled();
  });
});
