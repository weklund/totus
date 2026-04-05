// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock recharts to avoid SVG rendering issues in jsdom
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Area: () => <div data-testid="chart-area" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  ReferenceLine: () => <div data-testid="reference-line" />,
  ReferenceArea: () => <div data-testid="reference-area" />,
}));

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard/recovery",
}));

// Mock the useRecoveryView hook
const mockUseRecoveryView = vi.fn();
vi.mock("@/hooks/useRecoveryView", () => ({
  useRecoveryView: (...args: unknown[]) => mockUseRecoveryView(...args),
}));

// Mock useDismissInsight
vi.mock("@/hooks/useDismissInsight", () => ({
  useDismissInsight: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

import { RecoveryDetailView } from "../RecoveryDetailView";
import type { RecoveryViewResponse } from "@/hooks/useRecoveryView";

// ─── Mock Data (S3 scenario — Hard Workout Recovery Arc) ────────

const MOCK_RECOVERY_DATA: RecoveryViewResponse = {
  data: {
    date_range: {
      start: "2026-03-24",
      end: "2026-03-28",
    },
    triggering_event: {
      id: 42,
      source: "user",
      event_type: "workout",
      label: "10K run",
      note: "52 min, HR avg 168",
      occurred_at: "2026-03-24T07:00:00Z",
      ended_at: "2026-03-24T07:52:00Z",
    },
    insights: [
      {
        type: "suppressed_hrv",
        title: "Recovery in Progress",
        body: "After your 10K on Mar 24, it took 3 days for your HRV and readiness to return to baseline.",
        related_metrics: ["hrv", "readiness_score", "rhr"],
        severity: "info",
        dismissible: true,
      },
    ],
    daily: {
      "2026-03-24": {
        metrics: {
          readiness_score: {
            value: 42,
            avg_30d: 78,
            stddev_30d: 10,
            delta: -36,
            delta_pct: -46.15,
            direction: "worse",
            status: "critical",
          },
          sleep_score: {
            value: 71,
            avg_30d: 82,
            stddev_30d: 7,
            delta: -11,
            delta_pct: -13.41,
            direction: "worse",
            status: "warning",
          },
          hrv: {
            value: 26,
            avg_30d: 44,
            stddev_30d: 8,
            delta: -18,
            delta_pct: -40.91,
            direction: "worse",
            status: "critical",
          },
        },
      },
      "2026-03-25": {
        metrics: {
          readiness_score: {
            value: 61,
            avg_30d: 78,
            stddev_30d: 10,
            delta: -17,
            delta_pct: -21.79,
            direction: "worse",
            status: "warning",
          },
          sleep_score: {
            value: 74,
            avg_30d: 82,
            stddev_30d: 7,
            delta: -8,
            delta_pct: -9.76,
            direction: "worse",
            status: "warning",
          },
          hrv: {
            value: 34,
            avg_30d: 44,
            stddev_30d: 8,
            delta: -10,
            delta_pct: -22.73,
            direction: "worse",
            status: "warning",
          },
        },
      },
      "2026-03-26": {
        metrics: {
          readiness_score: {
            value: 68,
            avg_30d: 78,
            stddev_30d: 10,
            delta: -10,
            delta_pct: -12.82,
            direction: "worse",
            status: "warning",
          },
          sleep_score: {
            value: 81,
            avg_30d: 82,
            stddev_30d: 7,
            delta: -1,
            delta_pct: -1.22,
            direction: "worse",
            status: "normal",
          },
          hrv: {
            value: 40,
            avg_30d: 44,
            stddev_30d: 8,
            delta: -4,
            delta_pct: -9.09,
            direction: "worse",
            status: "normal",
          },
        },
      },
      "2026-03-27": {
        metrics: {
          readiness_score: {
            value: 82,
            avg_30d: 78,
            stddev_30d: 10,
            delta: 4,
            delta_pct: 5.13,
            direction: "better",
            status: "normal",
          },
          sleep_score: {
            value: 86,
            avg_30d: 82,
            stddev_30d: 7,
            delta: 4,
            delta_pct: 4.88,
            direction: "better",
            status: "normal",
          },
          hrv: {
            value: 48,
            avg_30d: 44,
            stddev_30d: 8,
            delta: 4,
            delta_pct: 9.09,
            direction: "better",
            status: "normal",
          },
        },
      },
      "2026-03-28": {
        metrics: {
          readiness_score: {
            value: 84,
            avg_30d: 78,
            stddev_30d: 10,
            delta: 6,
            delta_pct: 7.69,
            direction: "better",
            status: "good",
          },
          sleep_score: {
            value: 85,
            avg_30d: 82,
            stddev_30d: 7,
            delta: 3,
            delta_pct: 3.66,
            direction: "better",
            status: "normal",
          },
          hrv: {
            value: 50,
            avg_30d: 44,
            stddev_30d: 8,
            delta: 6,
            delta_pct: 13.64,
            direction: "better",
            status: "good",
          },
        },
      },
    },
    baselines: {
      readiness_score: {
        avg: 78,
        stddev: 10,
        upper: 88,
        lower: 68,
      },
      sleep_score: {
        avg: 82,
        stddev: 7,
        upper: 89,
        lower: 75,
      },
      hrv: {
        avg: 44,
        stddev: 8,
        upper: 52,
        lower: 36,
      },
    },
    sparklines: {
      readiness_score: {
        dates: [
          "2026-03-24",
          "2026-03-25",
          "2026-03-26",
          "2026-03-27",
          "2026-03-28",
        ],
        values: [42, 61, 68, 82, 84],
      },
      sleep_score: {
        dates: [
          "2026-03-24",
          "2026-03-25",
          "2026-03-26",
          "2026-03-27",
          "2026-03-28",
        ],
        values: [71, 74, 81, 86, 85],
      },
      hrv: {
        dates: [
          "2026-03-24",
          "2026-03-25",
          "2026-03-26",
          "2026-03-27",
          "2026-03-28",
        ],
        values: [26, 34, 40, 48, 50],
      },
    },
    annotations: [
      {
        id: 42,
        source: "user",
        event_type: "workout",
        label: "10K run",
        note: "52 min, HR avg 168",
        occurred_at: "2026-03-24T07:00:00Z",
        ended_at: "2026-03-24T07:52:00Z",
      },
    ],
  },
};

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function renderWithProviders(ui: React.ReactElement) {
  const qc = createQueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("RecoveryDetailView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Loading State ────────────────────────────────────────

  it("renders loading state", () => {
    mockUseRecoveryView.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <RecoveryDetailView
        startDate="2026-03-24"
        endDate="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("recovery-view-loading")).toBeInTheDocument();
  });

  // ─── Error State ──────────────────────────────────────────

  it("renders error state with retry button", () => {
    const mockRefetch = vi.fn();
    mockUseRecoveryView.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Network error"),
      refetch: mockRefetch,
    });

    renderWithProviders(
      <RecoveryDetailView
        startDate="2026-03-24"
        endDate="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("error-card")).toBeInTheDocument();
    expect(screen.getByTestId("retry-button")).toBeInTheDocument();
  });

  // ─── Empty State ──────────────────────────────────────────

  it("renders empty state when no data", () => {
    mockUseRecoveryView.mockReturnValue({
      data: {
        data: {
          date_range: { start: "2026-03-24", end: "2026-03-28" },
          triggering_event: null,
          insights: [],
          daily: {},
          baselines: {},
          sparklines: {},
          annotations: [],
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <RecoveryDetailView
        startDate="2026-03-24"
        endDate="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("recovery-view-empty")).toBeInTheDocument();
  });

  // ─── Full Render ──────────────────────────────────────────

  it("renders full recovery view with W2 components", () => {
    mockUseRecoveryView.mockReturnValue({
      data: MOCK_RECOVERY_DATA,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <RecoveryDetailView
        startDate="2026-03-24"
        endDate="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    // Insight card is rendered
    expect(screen.getByTestId("insight-card")).toBeInTheDocument();
    expect(screen.getByText(/Recovery in Progress/)).toBeInTheDocument();

    // MetricStripContainer is rendered with sparklines
    expect(screen.getByTestId("metric-strip-container")).toBeInTheDocument();

    // Metric strips rendered for each sparkline metric
    const strips = screen.getAllByTestId("metric-strip");
    expect(strips.length).toBeGreaterThanOrEqual(3); // readiness_score, sleep_score, hrv

    // Annotation layer rendered with workout marker
    expect(screen.getByTestId("annotation-layer")).toBeInTheDocument();

    // Daily score table rendered
    expect(screen.getByTestId("daily-score-table")).toBeInTheDocument();
  });

  // ─── Triggering Event ─────────────────────────────────────

  it("renders triggering event marker", () => {
    mockUseRecoveryView.mockReturnValue({
      data: MOCK_RECOVERY_DATA,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <RecoveryDetailView
        startDate="2026-03-24"
        endDate="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    // The triggering event annotation should be present
    expect(screen.getByTestId("annotation-layer")).toBeInTheDocument();
  });

  // ─── Daily Score Table ────────────────────────────────────

  it("renders daily score table with traffic-light colors", () => {
    mockUseRecoveryView.mockReturnValue({
      data: MOCK_RECOVERY_DATA,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <RecoveryDetailView
        startDate="2026-03-24"
        endDate="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    const table = screen.getByTestId("daily-score-table");

    // Should have date column headers (Mar 24, 2026 is a Tuesday)
    expect(within(table).getByText("Tue 24")).toBeInTheDocument();
    expect(within(table).getByText("Wed 25")).toBeInTheDocument();
    expect(within(table).getByText("Fri 27")).toBeInTheDocument();

    // Should have metric row labels
    expect(within(table).getByText(/Readiness/i)).toBeInTheDocument();

    // Should have traffic-light colored cells
    const scoreCells = within(table).getAllByTestId("score-cell");
    expect(scoreCells.length).toBeGreaterThanOrEqual(5); // At least 5 cells per metric row
  });

  // ─── No Insight Card When Empty ───────────────────────────

  it("does not render insight card when no insights", () => {
    const dataWithoutInsights: RecoveryViewResponse = {
      data: {
        ...MOCK_RECOVERY_DATA.data,
        insights: [],
      },
    };

    mockUseRecoveryView.mockReturnValue({
      data: dataWithoutInsights,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <RecoveryDetailView
        startDate="2026-03-24"
        endDate="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("insight-card")).not.toBeInTheDocument();
  });

  // ─── Sparklines With Baseline Bands ───────────────────────

  it("renders sparklines with baseline bands", () => {
    mockUseRecoveryView.mockReturnValue({
      data: MOCK_RECOVERY_DATA,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <RecoveryDetailView
        startDate="2026-03-24"
        endDate="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    // Baseline bands (ReferenceArea) should be present for metrics with baselines
    const refAreas = screen.getAllByTestId("reference-area");
    expect(refAreas.length).toBeGreaterThanOrEqual(3); // 3 metrics with baselines
  });

  // ─── No Triggering Event ──────────────────────────────────

  it("renders without triggering event when null", () => {
    const dataWithoutEvent: RecoveryViewResponse = {
      data: {
        ...MOCK_RECOVERY_DATA.data,
        triggering_event: null,
        annotations: [],
      },
    };

    mockUseRecoveryView.mockReturnValue({
      data: dataWithoutEvent,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <RecoveryDetailView
        startDate="2026-03-24"
        endDate="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    // Should still render the view without annotation layer
    expect(screen.getByTestId("recovery-detail-view")).toBeInTheDocument();
    expect(screen.queryByTestId("annotation-layer")).not.toBeInTheDocument();
  });

  // ─── Hook Called With Correct Args ────────────────────────

  it("calls useRecoveryView with correct arguments", () => {
    mockUseRecoveryView.mockReturnValue({
      data: MOCK_RECOVERY_DATA,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <RecoveryDetailView
        startDate="2026-03-24"
        endDate="2026-03-28"
        eventId="42"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    expect(mockUseRecoveryView).toHaveBeenCalledWith(
      "2026-03-24",
      "2026-03-28",
      undefined,
      "42",
    );
  });
});
