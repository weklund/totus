// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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

import { MetricStrip } from "../MetricStrip";
import type { BaselinePayload, SummaryMetric } from "@/lib/dashboard/types";

const MOCK_DATA = [
  { timestamp: "2026-03-27T20:00:00Z", value: 65 },
  { timestamp: "2026-03-27T21:00:00Z", value: 70 },
  { timestamp: "2026-03-27T22:00:00Z", value: 72 },
  { timestamp: "2026-03-27T23:00:00Z", value: 68 },
  { timestamp: "2026-03-28T00:00:00Z", value: 63 },
  { timestamp: "2026-03-28T01:00:00Z", value: 60 },
];

const MOCK_BASELINE: BaselinePayload = {
  avg_30d: 61,
  stddev_30d: 5,
  upper: 66,
  lower: 56,
  sample_count: 30,
};

const MOCK_SUMMARY: SummaryMetric = {
  value: 72,
  avg_30d: 61,
  stddev_30d: 5,
  delta: 11,
  delta_pct: 18.03,
  direction: "worse",
  status: "critical",
};

describe("MetricStrip", () => {
  it("renders sparkline with data", () => {
    render(<MetricStrip metricType="rhr" data={MOCK_DATA} />);
    expect(screen.getByTestId("metric-strip")).toBeInTheDocument();
    expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
    expect(screen.getByTestId("area-chart")).toBeInTheDocument();
  });

  it("shows metric label and current value in header", () => {
    render(<MetricStrip metricType="rhr" data={MOCK_DATA} />);
    const header = screen.getByTestId("metric-strip-header");
    expect(header).toHaveTextContent("Resting Heart Rate");
    expect(header).toHaveTextContent("60"); // last value
    expect(header).toHaveTextContent("bpm");
  });

  it("renders baseline band when baseline is provided", () => {
    render(
      <MetricStrip
        metricType="rhr"
        data={MOCK_DATA}
        baseline={MOCK_BASELINE}
      />,
    );
    // BaselineBand renders a ReferenceArea
    expect(screen.getByTestId("reference-area")).toBeInTheDocument();
    // Baseline dashed line
    expect(screen.getByTestId("reference-line")).toBeInTheDocument();
  });

  it("shows DeltaBadge when summary is provided", () => {
    render(
      <MetricStrip metricType="rhr" data={MOCK_DATA} summary={MOCK_SUMMARY} />,
    );
    expect(screen.getByTestId("delta-badge")).toBeInTheDocument();
    expect(screen.getByTestId("delta-badge")).toHaveTextContent("11");
  });

  it("expands on header click", () => {
    render(<MetricStrip metricType="rhr" data={MOCK_DATA} />);
    const header = screen.getByTestId("metric-strip-header");
    expect(header).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
  });

  it("collapses on second header click", () => {
    render(<MetricStrip metricType="rhr" data={MOCK_DATA} />);
    const header = screen.getByTestId("metric-strip-header");
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
  });

  it("shows loading skeleton", () => {
    render(<MetricStrip metricType="rhr" data={[]} isLoading={true} />);
    expect(screen.getByTestId("metric-strip-loading")).toBeInTheDocument();
  });

  it("shows empty state when no data", () => {
    render(<MetricStrip metricType="rhr" data={[]} />);
    expect(screen.getByTestId("metric-strip-empty")).toBeInTheDocument();
    expect(screen.getByText(/no resting heart rate data/i)).toBeInTheDocument();
  });
});
