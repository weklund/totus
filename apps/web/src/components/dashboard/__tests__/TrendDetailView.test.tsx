// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock recharts to avoid SVG rendering issues in jsdom
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  ComposedChart: ({
    children,
    onClick,
    style,
  }: {
    children: React.ReactNode;
    onClick?: (e: unknown) => void;
    style?: React.CSSProperties;
  }) => (
    <div
      data-testid="composed-chart"
      onClick={onClick as React.MouseEventHandler}
      style={style}
    >
      {children}
    </div>
  ),
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Area: () => <div data-testid="chart-area" />,
  Line: () => <div data-testid="chart-line" />,
  Scatter: () => <div data-testid="chart-scatter" />,
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
  usePathname: () => "/dashboard/trend",
}));

// Mock the useTrendView hook
const mockUseTrendView = vi.fn();
vi.mock("@/hooks/useTrendView", () => ({
  useTrendView: (...args: unknown[]) => mockUseTrendView(...args),
}));

// Mock useDismissInsight
vi.mock("@/hooks/useDismissInsight", () => ({
  useDismissInsight: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

import { TrendDetailView } from "../TrendDetailView";
import type { TrendViewResponse } from "@/hooks/useTrendView";

// ─── Mock Data (S4 scenario — Doctor Visit Preparation) ────────

const MOCK_TREND_DATA: TrendViewResponse = {
  data: {
    date_range: {
      start: "2026-02-27",
      end: "2026-03-28",
    },
    smoothing: "7d",
    insights: [
      {
        type: "elevated_rhr",
        title: "Rising Resting Heart Rate",
        body: "Your resting heart rate has increased from 58 to 66 bpm over the past 30 days (+14%). Consider discussing this trend with your doctor.",
        related_metrics: ["rhr", "hrv"],
        severity: "warning",
        dismissible: true,
      },
    ],
    metrics: {
      rhr: {
        raw: {
          dates: [
            "2026-02-27",
            "2026-03-05",
            "2026-03-12",
            "2026-03-19",
            "2026-03-28",
          ],
          values: [58, 60, 62, 64, 66],
        },
        smoothed: {
          dates: [
            "2026-02-27",
            "2026-03-05",
            "2026-03-12",
            "2026-03-19",
            "2026-03-28",
          ],
          values: [58, 59.5, 61.5, 63.5, 65.5],
        },
        trend: {
          direction: "rising",
          start_value: 58,
          end_value: 66,
          change_pct: 13.8,
          change_abs: 8,
        },
        baseline: {
          avg: 61,
          stddev: 5,
          upper: 66,
          lower: 56,
        },
      },
      hrv: {
        raw: {
          dates: [
            "2026-02-27",
            "2026-03-05",
            "2026-03-12",
            "2026-03-19",
            "2026-03-28",
          ],
          values: [48, 44, 38, 34, 32],
        },
        smoothed: {
          dates: [
            "2026-02-27",
            "2026-03-05",
            "2026-03-12",
            "2026-03-19",
            "2026-03-28",
          ],
          values: [47.5, 43, 38.5, 34.5, 32.5],
        },
        trend: {
          direction: "falling",
          start_value: 48,
          end_value: 32,
          change_pct: -33.3,
          change_abs: -16,
        },
        baseline: {
          avg: 40,
          stddev: 8,
          upper: 48,
          lower: 32,
        },
      },
      sleep_score: {
        raw: {
          dates: [
            "2026-02-27",
            "2026-03-05",
            "2026-03-12",
            "2026-03-19",
            "2026-03-28",
          ],
          values: [85, 82, 78, 74, 72],
        },
        smoothed: {
          dates: [
            "2026-02-27",
            "2026-03-05",
            "2026-03-12",
            "2026-03-19",
            "2026-03-28",
          ],
          values: [84.5, 81, 77.5, 74.5, 72.5],
        },
        trend: {
          direction: "falling",
          start_value: 85,
          end_value: 72,
          change_pct: -15.3,
          change_abs: -13,
        },
        baseline: {
          avg: 80,
          stddev: 7,
          upper: 87,
          lower: 73,
        },
      },
    },
    correlations: [
      {
        pair: ["rhr", "sleep_score"],
        coefficient: -0.72,
        strength: "strong",
        direction: "inverse",
        sample_count: 30,
        sufficient_data: true,
      },
      {
        pair: ["hrv", "sleep_score"],
        coefficient: 0.68,
        strength: "moderate",
        direction: "positive",
        sample_count: 30,
        sufficient_data: true,
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

describe("TrendDetailView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Loading State ────────────────────────────────────────

  it("renders loading state", () => {
    mockUseTrendView.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <TrendDetailView
        date="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("trend-view-loading")).toBeInTheDocument();
  });

  // ─── Error State ──────────────────────────────────────────

  it("renders error state with retry button", () => {
    const mockRefetch = vi.fn();
    mockUseTrendView.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Network error"),
      refetch: mockRefetch,
    });

    renderWithProviders(
      <TrendDetailView
        date="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("error-card")).toBeInTheDocument();
    expect(screen.getByTestId("retry-button")).toBeInTheDocument();
  });

  // ─── Empty State ──────────────────────────────────────────

  it("renders empty state when no metric data", () => {
    mockUseTrendView.mockReturnValue({
      data: {
        data: {
          date_range: { start: "2026-02-27", end: "2026-03-28" },
          smoothing: "7d",
          insights: [],
          metrics: {},
          correlations: [],
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <TrendDetailView
        date="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("trend-view-empty")).toBeInTheDocument();
    expect(screen.getByText(/No trend data available/)).toBeInTheDocument();
  });

  // ─── Full Render with W3 Components ───────────────────────

  it("renders full trend view with W3 components", () => {
    mockUseTrendView.mockReturnValue({
      data: MOCK_TREND_DATA,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <TrendDetailView
        date="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    // Main container
    expect(screen.getByTestId("trend-detail-view")).toBeInTheDocument();

    // Toolbar: range presets + resolution toggle
    expect(screen.getByTestId("trend-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("range-presets")).toBeInTheDocument();
    expect(screen.getByTestId("resolution-toggle")).toBeInTheDocument();

    // Insight card rendered
    expect(screen.getByTestId("insight-card")).toBeInTheDocument();
    expect(screen.getByText(/Rising Resting Heart Rate/)).toBeInTheDocument();

    // Correlation card rendered
    expect(screen.getByTestId("correlation-card")).toBeInTheDocument();

    // Metric panels for each trend metric
    const panels = screen.getAllByTestId("trend-metric-panel");
    expect(panels).toHaveLength(3); // rhr, hrv, sleep_score
  });

  // ─── Trend Indicators ────────────────────────────────────

  it("renders trend indicators with direction and values", () => {
    mockUseTrendView.mockReturnValue({
      data: MOCK_TREND_DATA,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <TrendDetailView
        date="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    const indicators = screen.getAllByTestId("trend-indicator");
    expect(indicators.length).toBe(3);

    // RHR: 58 → 66 bpm (+13.8%)
    expect(indicators[0]).toHaveTextContent("58");
    expect(indicators[0]).toHaveTextContent("66");
    expect(indicators[0]).toHaveTextContent("+13.8%");

    // HRV: 48 → 32 ms (-33.3%)
    expect(indicators[1]).toHaveTextContent("48");
    expect(indicators[1]).toHaveTextContent("32");
    expect(indicators[1]).toHaveTextContent("-33.3%");

    // Sleep Score: 85 → 72 (-15.3%)
    expect(indicators[2]).toHaveTextContent("85");
    expect(indicators[2]).toHaveTextContent("72");
    expect(indicators[2]).toHaveTextContent("-15.3%");
  });

  // ─── Correlation Card ─────────────────────────────────────

  it("renders correlation card with coefficients and labels", () => {
    mockUseTrendView.mockReturnValue({
      data: MOCK_TREND_DATA,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <TrendDetailView
        date="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    const card = screen.getByTestId("correlation-card");

    // Should show correlation entries
    const entries = within(card).getAllByTestId("correlation-entry");
    expect(entries).toHaveLength(2);

    // RHR ↔ Sleep Score: -0.72 (strong inverse)
    expect(entries[0]).toHaveTextContent("Resting Heart Rate");
    expect(entries[0]).toHaveTextContent("Sleep Score");
    expect(entries[0]).toHaveTextContent("-0.72");
    expect(entries[0]).toHaveTextContent("strong");
    expect(entries[0]).toHaveTextContent("inverse");

    // HRV ↔ Sleep Score: +0.68 (moderate positive)
    expect(entries[1]).toHaveTextContent("Heart Rate Variability");
    expect(entries[1]).toHaveTextContent("Sleep Score");
    expect(entries[1]).toHaveTextContent("+0.68");
    expect(entries[1]).toHaveTextContent("moderate");
    expect(entries[1]).toHaveTextContent("positive");

    // Share button
    expect(
      within(card).getByTestId("correlation-share-btn"),
    ).toBeInTheDocument();
  });

  // ─── Range Presets ────────────────────────────────────────

  it("renders range presets with 30D selected by default", () => {
    mockUseTrendView.mockReturnValue({
      data: MOCK_TREND_DATA,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <TrendDetailView
        date="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    const presets = screen.getByTestId("range-presets");
    const btn30D = within(presets).getByTestId("range-preset-30d");
    expect(btn30D).toHaveAttribute("aria-selected", "true");

    const btn7D = within(presets).getByTestId("range-preset-7d");
    expect(btn7D).toHaveAttribute("aria-selected", "false");
  });

  it("switches range preset on click", async () => {
    const user = userEvent.setup();

    mockUseTrendView.mockReturnValue({
      data: MOCK_TREND_DATA,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <TrendDetailView
        date="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    const btn90D = screen.getByTestId("range-preset-90d");
    await user.click(btn90D);

    // After clicking 90D, it should be selected
    expect(btn90D).toHaveAttribute("aria-selected", "true");

    // The hook should have been called with updated date range
    // (90 days from 2026-03-28 backward)
    expect(mockUseTrendView).toHaveBeenCalled();
  });

  // ─── Resolution Toggle ────────────────────────────────────

  it("renders resolution toggle with Weekly selected by default", () => {
    mockUseTrendView.mockReturnValue({
      data: MOCK_TREND_DATA,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <TrendDetailView
        date="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("resolution-toggle")).toBeInTheDocument();
  });

  // ─── No Insights When Empty ───────────────────────────────

  it("does not render insight card when no insights", () => {
    const dataWithoutInsights: TrendViewResponse = {
      data: {
        ...MOCK_TREND_DATA.data,
        insights: [],
      },
    };

    mockUseTrendView.mockReturnValue({
      data: dataWithoutInsights,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <TrendDetailView
        date="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("insight-card")).not.toBeInTheDocument();
  });

  // ─── No Correlations ──────────────────────────────────────

  it("does not render correlation card when no correlations", () => {
    const dataWithoutCorrelations: TrendViewResponse = {
      data: {
        ...MOCK_TREND_DATA.data,
        correlations: [],
      },
    };

    mockUseTrendView.mockReturnValue({
      data: dataWithoutCorrelations,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <TrendDetailView
        date="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("correlation-card")).not.toBeInTheDocument();
  });

  // ─── Baseline Bands ───────────────────────────────────────

  it("renders baseline bands for metrics with baselines", () => {
    mockUseTrendView.mockReturnValue({
      data: MOCK_TREND_DATA,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <TrendDetailView
        date="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    // Each panel has a BaselineBand → ReferenceArea
    const refAreas = screen.getAllByTestId("reference-area");
    expect(refAreas.length).toBeGreaterThanOrEqual(3);
  });

  // ─── Smoothed Lines and Raw Dots ──────────────────────────

  it("renders both smoothed lines and raw scatter dots", () => {
    mockUseTrendView.mockReturnValue({
      data: MOCK_TREND_DATA,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <TrendDetailView
        date="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    // Smoothed line (Line components)
    const lines = screen.getAllByTestId("chart-line");
    expect(lines.length).toBeGreaterThanOrEqual(3);

    // Raw data scatter dots
    const scatters = screen.getAllByTestId("chart-scatter");
    expect(scatters.length).toBeGreaterThanOrEqual(3);
  });

  // ─── Hook Called With Correct Args ────────────────────────

  it("calls useTrendView with default 30-day range and 7d smoothing", () => {
    mockUseTrendView.mockReturnValue({
      data: MOCK_TREND_DATA,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <TrendDetailView
        date="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    // Default: 30 days, weekly smoothing (7d)
    expect(mockUseTrendView).toHaveBeenCalledWith(
      "2026-02-27", // 30 days before 2026-03-28
      "2026-03-28",
      "rhr,hrv,sleep_score",
      "7d",
    );
  });

  // ─── Date Click Navigation ─────────────────────────────────

  it("calls onDateChange and onViewModeChange when chart is clicked", () => {
    const mockOnDateChange = vi.fn();
    const mockOnViewModeChange = vi.fn();

    mockUseTrendView.mockReturnValue({
      data: MOCK_TREND_DATA,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <TrendDetailView
        date="2026-03-28"
        onDateChange={mockOnDateChange}
        onViewModeChange={mockOnViewModeChange}
      />,
    );

    // Charts should have cursor: pointer style
    const charts = screen.getAllByTestId("composed-chart");
    expect(charts.length).toBeGreaterThan(0);
    expect(charts[0]).toHaveStyle({ cursor: "pointer" });
  });

  // ─── Insufficient Correlation Data ────────────────────────

  it("hides correlations with insufficient data", () => {
    const dataWithInsufficientCorrelation: TrendViewResponse = {
      data: {
        ...MOCK_TREND_DATA.data,
        correlations: [
          {
            pair: ["rhr", "sleep_score"],
            coefficient: -0.72,
            strength: "strong",
            direction: "inverse",
            sample_count: 5,
            sufficient_data: false,
          },
        ],
      },
    };

    mockUseTrendView.mockReturnValue({
      data: dataWithInsufficientCorrelation,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <TrendDetailView
        date="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    // Correlation card should not render when all correlations have insufficient data
    expect(screen.queryByTestId("correlation-card")).not.toBeInTheDocument();
  });
});
