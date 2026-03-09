// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ViewerContent } from "../ViewerContent";
import { ViewContextProvider } from "@/lib/view-context";
import type { ViewContextValue } from "@/types/view-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock useHealthDataTypes
const mockTypesData = {
  data: {
    types: [
      {
        metric_type: "sleep_score",
        label: "Sleep Score",
        unit: "score",
        category: "Sleep",
        source: "oura",
        date_range: { start: "2026-01-01", end: "2026-03-01" },
        count: 90,
      },
      {
        metric_type: "hrv",
        label: "Heart Rate Variability",
        unit: "ms",
        category: "Cardio",
        source: "oura",
        date_range: { start: "2026-01-01", end: "2026-03-01" },
        count: 90,
      },
      {
        metric_type: "rhr",
        label: "Resting Heart Rate",
        unit: "bpm",
        category: "Cardio",
        source: "oura",
        date_range: { start: "2026-01-01", end: "2026-03-01" },
        count: 90,
      },
      {
        metric_type: "steps",
        label: "Steps",
        unit: "steps",
        category: "Activity",
        source: "oura",
        date_range: { start: "2026-01-01", end: "2026-03-01" },
        count: 90,
      },
      {
        metric_type: "readiness_score",
        label: "Readiness Score",
        unit: "score",
        category: "Activity",
        source: "oura",
        date_range: { start: "2026-01-01", end: "2026-03-01" },
        count: 90,
      },
    ],
  },
};

vi.mock("@/hooks/useHealthDataTypes", () => ({
  useHealthDataTypes: () => ({
    data: mockTypesData,
    isLoading: false,
  }),
}));

// Mock useHealthData and useViewerData
vi.mock("@/hooks/useHealthData", () => ({
  useHealthData: () => ({
    data: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useViewerData", () => ({
  useViewerData: () => ({
    data: {
      data: {
        metrics: {
          sleep_score: {
            unit: "score",
            points: [{ date: "2026-01-01", value: 85, source: "oura" }],
          },
          hrv: {
            unit: "ms",
            points: [{ date: "2026-01-01", value: 45, source: "oura" }],
          },
        },
        query: {
          start: "2026-01-01",
          end: "2026-03-01",
          resolution: "daily",
          metrics_requested: ["sleep_score", "hrv"],
          metrics_returned: ["sleep_score", "hrv"],
        },
      },
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// Mock Recharts to avoid DOM measurement issues in jsdom
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ComposedChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="composed-chart">{children}</div>
  ),
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  Legend: () => <div />,
}));

const viewerContext: ViewContextValue = {
  role: "viewer",
  grantId: "grant_abc",
  permissions: {
    metrics: ["sleep_score", "hrv"],
    dataStart: "2026-01-01",
    dataEnd: "2026-03-01",
  },
  ownerDisplayName: "Dr. Smith",
};

function renderWithProviders(
  ui: React.ReactElement,
  ctx: ViewContextValue = viewerContext,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ViewContextProvider value={ctx}>{ui}</ViewContextProvider>
    </QueryClientProvider>,
  );
}

describe("ViewerContent", () => {
  it("renders viewer content container", () => {
    renderWithProviders(<ViewerContent />);
    expect(screen.getByTestId("viewer-content")).toBeDefined();
  });

  it("shows only granted metrics in MetricSelector", async () => {
    renderWithProviders(<ViewerContent />);

    await waitFor(() => {
      expect(screen.getByTestId("metric-selector")).toBeDefined();
    });

    // Should show granted metrics (sleep_score, hrv)
    expect(screen.getByText("Sleep Score")).toBeDefined();
    expect(screen.getByText("Heart Rate Variability")).toBeDefined();

    // Should NOT show non-granted metrics
    expect(screen.queryByText("Resting Heart Rate")).toBeNull();
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Readiness Score")).toBeNull();
  });

  it("hides date range presets for viewer", () => {
    renderWithProviders(<ViewerContent />);

    // Presets should NOT be visible
    expect(screen.queryByTestId("preset-1W")).toBeNull();
    expect(screen.queryByTestId("preset-1M")).toBeNull();
    expect(screen.queryByTestId("preset-3M")).toBeNull();
  });

  it("shows resolution toggle", () => {
    renderWithProviders(<ViewerContent />);
    expect(screen.getByTestId("resolution-toggle")).toBeDefined();
  });

  it("does not show ActionBar", () => {
    renderWithProviders(<ViewerContent />);
    expect(screen.queryByTestId("action-bar")).toBeNull();
  });

  it("shows date range picker (custom picker)", () => {
    renderWithProviders(<ViewerContent />);
    expect(screen.getByTestId("date-range-selector")).toBeDefined();
  });
});
