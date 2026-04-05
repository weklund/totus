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
  usePathname: () => "/dashboard",
}));

// Mock the useNightView hook
const mockUseNightView = vi.fn();
vi.mock("@/hooks/useNightView", () => ({
  useNightView: (...args: unknown[]) => mockUseNightView(...args),
}));

// Mock useDismissInsight
vi.mock("@/hooks/useDismissInsight", () => ({
  useDismissInsight: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

import { NightDetailView } from "../NightDetailView";
import type { NightViewResponse } from "@/hooks/useNightView";

// ─── Mock Data ──────────────────────────────────────────────────

const MOCK_NIGHT_DATA: NightViewResponse = {
  data: {
    date: "2026-03-28",
    time_range: {
      start: "2026-03-27T20:00:00Z",
      end: "2026-03-28T08:00:00Z",
    },
    insights: [
      {
        type: "elevated_rhr",
        title: "Elevated Resting Heart Rate",
        body: "Your resting HR was 11 bpm above your 30-day average. Sleep onset took 35 min (usually 12).",
        related_metrics: ["rhr", "heart_rate", "sleep_latency"],
        severity: "warning",
        dismissible: true,
      },
    ],
    annotations: [
      {
        id: 1,
        source: "user",
        event_type: "meal",
        label: "Late dinner",
        note: "Carb-heavy pasta",
        occurred_at: "2026-03-27T21:30:00Z",
        ended_at: null,
      },
    ],
    series: {
      glucose: {
        timestamps: [
          "2026-03-27T20:00:00Z",
          "2026-03-27T21:00:00Z",
          "2026-03-27T22:00:00Z",
          "2026-03-27T23:00:00Z",
          "2026-03-28T00:00:00Z",
        ],
        values: [110, 145, 180, 150, 120],
      },
      heart_rate: {
        timestamps: [
          "2026-03-27T20:00:00Z",
          "2026-03-27T21:00:00Z",
          "2026-03-27T22:00:00Z",
          "2026-03-27T23:00:00Z",
          "2026-03-28T00:00:00Z",
        ],
        values: [65, 70, 72, 68, 60],
      },
    },
    hypnogram: {
      stages: [
        {
          stage: "awake",
          start: "2026-03-27T22:30:00Z",
          end: "2026-03-27T23:05:00Z",
        },
        {
          stage: "light",
          start: "2026-03-27T23:05:00Z",
          end: "2026-03-28T00:00:00Z",
        },
        {
          stage: "deep",
          start: "2026-03-28T00:00:00Z",
          end: "2026-03-28T01:30:00Z",
        },
        {
          stage: "rem",
          start: "2026-03-28T01:30:00Z",
          end: "2026-03-28T03:00:00Z",
        },
      ],
      total_duration_hr: 7.5,
    },
    summary: {
      sleep_score: {
        value: 64,
        avg_30d: 83,
        stddev_30d: 8,
        delta: -19,
        delta_pct: -22.89,
        direction: "worse",
        status: "critical",
      },
      deep_sleep: {
        value: 0.8,
        avg_30d: 1.6,
        stddev_30d: 0.3,
        delta: -0.8,
        delta_pct: -50,
        direction: "worse",
        status: "critical",
      },
      rhr: {
        value: 72,
        avg_30d: 61,
        stddev_30d: 5,
        delta: 11,
        delta_pct: 18.03,
        direction: "worse",
        status: "critical",
      },
      hrv: {
        value: 32,
        avg_30d: 45,
        stddev_30d: 8,
        delta: -13,
        delta_pct: -28.89,
        direction: "worse",
        status: "warning",
      },
    },
    baselines: {
      glucose: {
        avg: 110,
        stddev: 20,
        upper: 130,
        lower: 90,
      },
      heart_rate: {
        avg: 61,
        stddev: 5,
        upper: 66,
        lower: 56,
      },
    },
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

describe("NightDetailView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state", () => {
    mockUseNightView.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <NightDetailView
        date="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("night-view-loading")).toBeInTheDocument();
  });

  it("renders error state with retry button", () => {
    const mockRefetch = vi.fn();
    mockUseNightView.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Network error"),
      refetch: mockRefetch,
    });

    renderWithProviders(
      <NightDetailView
        date="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("error-card")).toBeInTheDocument();
    expect(screen.getByTestId("retry-button")).toBeInTheDocument();
  });

  it("renders empty state when no data", () => {
    mockUseNightView.mockReturnValue({
      data: {
        data: {
          date: "2026-03-28",
          time_range: {
            start: "2026-03-27T20:00:00Z",
            end: "2026-03-28T08:00:00Z",
          },
          insights: [],
          annotations: [],
          series: {},
          hypnogram: null,
          summary: {},
          baselines: {},
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <NightDetailView
        date="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("night-view-empty")).toBeInTheDocument();
  });

  it("renders full night view with all W1 components", () => {
    mockUseNightView.mockReturnValue({
      data: MOCK_NIGHT_DATA,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <NightDetailView
        date="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    // Insight card is rendered
    expect(screen.getByTestId("insight-card")).toBeInTheDocument();
    expect(screen.getByText(/Elevated Resting Heart Rate/)).toBeInTheDocument();

    // MetricStripContainer is rendered
    expect(screen.getByTestId("metric-strip-container")).toBeInTheDocument();

    // Metric strips are rendered (glucose + heart_rate)
    const strips = screen.getAllByTestId("metric-strip");
    expect(strips.length).toBeGreaterThanOrEqual(2);

    // Sleep hypnogram is rendered
    expect(screen.getByTestId("sleep-hypnogram")).toBeInTheDocument();

    // Summary strip is rendered
    expect(screen.getByTestId("summary-strip")).toBeInTheDocument();

    // Annotation layer is rendered
    expect(screen.getByTestId("annotation-layer")).toBeInTheDocument();
  });

  it("renders metric strips for each series metric", () => {
    mockUseNightView.mockReturnValue({
      data: MOCK_NIGHT_DATA,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <NightDetailView
        date="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    // Should have strips for glucose and heart_rate
    const strips = screen.getAllByTestId("metric-strip");
    expect(strips.length).toBe(2);
  });

  it("renders summary strip with polarity-colored deltas", () => {
    mockUseNightView.mockReturnValue({
      data: MOCK_NIGHT_DATA,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <NightDetailView
        date="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    const summaryStrip = screen.getByTestId("summary-strip");
    // Summary metrics should display delta badges
    const deltaBadges = within(summaryStrip).getAllByTestId("delta-badge");
    expect(deltaBadges.length).toBeGreaterThanOrEqual(1);
  });

  it("does not render insight card when no insights", () => {
    const dataWithoutInsights = {
      ...MOCK_NIGHT_DATA,
      data: {
        ...MOCK_NIGHT_DATA.data,
        insights: [],
      },
    };

    mockUseNightView.mockReturnValue({
      data: dataWithoutInsights,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <NightDetailView
        date="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("insight-card")).not.toBeInTheDocument();
  });

  it("renders hypnogram empty state when hypnogram is null", () => {
    const dataWithoutHypnogram = {
      ...MOCK_NIGHT_DATA,
      data: {
        ...MOCK_NIGHT_DATA.data,
        hypnogram: null,
      },
    };

    mockUseNightView.mockReturnValue({
      data: dataWithoutHypnogram,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <NightDetailView
        date="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("hypnogram-empty")).toBeInTheDocument();
  });

  it("passes baseline data to metric strips", () => {
    mockUseNightView.mockReturnValue({
      data: MOCK_NIGHT_DATA,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <NightDetailView
        date="2026-03-28"
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    // Baseline bands (ReferenceArea) should be present for metrics with baselines
    const refAreas = screen.getAllByTestId("reference-area");
    expect(refAreas.length).toBeGreaterThanOrEqual(2); // glucose + heart_rate
  });
});
