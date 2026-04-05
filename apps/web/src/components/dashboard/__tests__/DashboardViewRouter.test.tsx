// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock recharts
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  ComposedChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="composed-chart">{children}</div>
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

// Track router calls
const mockReplace = vi.fn();
const mockPush = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: vi.fn(),
  }),
  useSearchParams: () => currentSearchParams,
  usePathname: () => "/dashboard",
}));

// Mock hooks to return loading/empty states by default
const mockUseNightView = vi.fn();
const mockUseRecoveryView = vi.fn();
const mockUseTrendView = vi.fn();

vi.mock("@/hooks/useNightView", () => ({
  useNightView: (...args: unknown[]) => mockUseNightView(...args),
}));

vi.mock("@/hooks/useRecoveryView", () => ({
  useRecoveryView: (...args: unknown[]) => mockUseRecoveryView(...args),
}));

vi.mock("@/hooks/useTrendView", () => ({
  useTrendView: (...args: unknown[]) => mockUseTrendView(...args),
}));

vi.mock("@/hooks/useDismissInsight", () => ({
  useDismissInsight: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

import { DashboardViewRouter } from "../DashboardViewRouter";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderWithProviders(ui: React.ReactElement) {
  const qc = createQueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function setupEmptyViewMocks() {
  const emptyResult = {
    data: undefined,
    isLoading: true,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
  mockUseNightView.mockReturnValue(emptyResult);
  mockUseRecoveryView.mockReturnValue(emptyResult);
  mockUseTrendView.mockReturnValue(emptyResult);
}

describe("DashboardViewRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams();
    setupEmptyViewMocks();
  });

  describe("default behavior", () => {
    it("defaults to night view when no URL params", () => {
      renderWithProviders(<DashboardViewRouter />);

      // DateNavigation should show night as active
      const nightTab = screen.getByTestId("view-mode-night");
      expect(nightTab).toHaveAttribute("aria-selected", "true");
    });

    it("defaults to today's date when no date param", () => {
      renderWithProviders(<DashboardViewRouter />);

      // The DateNavigation picker should show "Today"
      expect(screen.getByTestId("date-nav-picker")).toHaveTextContent("Today");
    });

    it("renders DateNavigation component", () => {
      renderWithProviders(<DashboardViewRouter />);
      expect(screen.getByTestId("date-navigation")).toBeInTheDocument();
    });
  });

  describe("deep linking via URL params", () => {
    it("reads view param from URL", () => {
      currentSearchParams = new URLSearchParams("view=recovery");
      renderWithProviders(<DashboardViewRouter />);

      const recoveryTab = screen.getByTestId("view-mode-recovery");
      expect(recoveryTab).toHaveAttribute("aria-selected", "true");
    });

    it("reads date param from URL", () => {
      currentSearchParams = new URLSearchParams("view=night&date=2026-03-28");
      renderWithProviders(<DashboardViewRouter />);

      expect(screen.getByTestId("date-nav-picker")).toHaveTextContent("Mar 28");
    });

    it("reads trend view from URL", () => {
      currentSearchParams = new URLSearchParams("view=trend");
      renderWithProviders(<DashboardViewRouter />);

      const trendTab = screen.getByTestId("view-mode-trend");
      expect(trendTab).toHaveAttribute("aria-selected", "true");
    });

    it("falls back to night view for invalid view param", () => {
      currentSearchParams = new URLSearchParams("view=invalid");
      renderWithProviders(<DashboardViewRouter />);

      const nightTab = screen.getByTestId("view-mode-night");
      expect(nightTab).toHaveAttribute("aria-selected", "true");
    });

    it("ignores invalid date param and falls back to today", () => {
      currentSearchParams = new URLSearchParams("view=night&date=not-a-date");
      renderWithProviders(<DashboardViewRouter />);

      // Should show today when date is invalid
      expect(screen.getByTestId("date-nav-picker")).toHaveTextContent("Today");
    });
  });

  describe("view switching", () => {
    it("updates URL when switching to recovery view", () => {
      renderWithProviders(<DashboardViewRouter />);

      fireEvent.click(screen.getByTestId("view-mode-recovery"));

      // Should call router.replace with updated view param
      expect(mockReplace).toHaveBeenCalled();
      const callArg = mockReplace.mock.calls[0][0];
      expect(callArg).toContain("view=recovery");
    });

    it("updates URL when switching to trend view", () => {
      renderWithProviders(<DashboardViewRouter />);

      fireEvent.click(screen.getByTestId("view-mode-trend"));

      expect(mockReplace).toHaveBeenCalled();
      const callArg = mockReplace.mock.calls[0][0];
      expect(callArg).toContain("view=trend");
    });

    it("preserves date when switching views", () => {
      currentSearchParams = new URLSearchParams("view=night&date=2026-03-25");
      renderWithProviders(<DashboardViewRouter />);

      fireEvent.click(screen.getByTestId("view-mode-recovery"));

      expect(mockReplace).toHaveBeenCalled();
      const callArg = mockReplace.mock.calls[0][0];
      expect(callArg).toContain("date=2026-03-25");
      expect(callArg).toContain("view=recovery");
    });
  });

  describe("date navigation", () => {
    it("updates URL when navigating to previous day", () => {
      currentSearchParams = new URLSearchParams("view=night&date=2026-03-28");
      renderWithProviders(<DashboardViewRouter />);

      fireEvent.click(screen.getByTestId("date-nav-prev"));

      expect(mockReplace).toHaveBeenCalled();
      const callArg = mockReplace.mock.calls[0][0];
      expect(callArg).toContain("date=2026-03-27");
    });

    it("preserves view when navigating dates", () => {
      currentSearchParams = new URLSearchParams(
        "view=recovery&date=2026-03-28",
      );
      renderWithProviders(<DashboardViewRouter />);

      fireEvent.click(screen.getByTestId("date-nav-prev"));

      expect(mockReplace).toHaveBeenCalled();
      const callArg = mockReplace.mock.calls[0][0];
      expect(callArg).toContain("view=recovery");
    });
  });

  describe("renders correct view component", () => {
    it("renders NightDetailView for night view", () => {
      currentSearchParams = new URLSearchParams("view=night");
      renderWithProviders(<DashboardViewRouter />);

      // Night view's loading state
      expect(screen.getByTestId("night-view-loading")).toBeInTheDocument();
    });

    it("renders RecoveryDetailView for recovery view", () => {
      currentSearchParams = new URLSearchParams("view=recovery");
      renderWithProviders(<DashboardViewRouter />);

      expect(screen.getByTestId("recovery-view-loading")).toBeInTheDocument();
    });

    it("renders TrendDetailView for trend view", () => {
      currentSearchParams = new URLSearchParams("view=trend");
      renderWithProviders(<DashboardViewRouter />);

      expect(screen.getByTestId("trend-view-loading")).toBeInTheDocument();
    });
  });

  describe("empty / first-visit state", () => {
    it("renders night view empty state for first visit with no data", () => {
      currentSearchParams = new URLSearchParams("view=night");
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

      renderWithProviders(<DashboardViewRouter />);

      expect(screen.getByTestId("night-view-empty")).toBeInTheDocument();
    });
  });

  describe("no page reloads", () => {
    it("uses router.replace (not push) for view switching to avoid page reload", () => {
      renderWithProviders(<DashboardViewRouter />);

      fireEvent.click(screen.getByTestId("view-mode-trend"));

      // replace is used for shallow URL updates (no full navigation)
      expect(mockReplace).toHaveBeenCalled();
    });
  });
});
