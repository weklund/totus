// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock recharts to avoid SVG rendering issues in jsdom
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  ComposedChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="composed-chart">{children}</div>
  ),
  Line: () => <div data-testid="chart-line" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
}));

import { MetricChart } from "../MetricChart";

const MOCK_DATA = {
  sleep_score: {
    unit: "score",
    points: [
      { date: "2026-01-01", value: 85, source: "oura" },
      { date: "2026-01-02", value: 78, source: "oura" },
      { date: "2026-01-03", value: 92, source: "oura" },
    ],
  },
  hrv: {
    unit: "ms",
    points: [
      { date: "2026-01-01", value: 42, source: "oura" },
      { date: "2026-01-02", value: 38, source: "oura" },
      { date: "2026-01-03", value: 55, source: "oura" },
    ],
  },
};

describe("MetricChart", () => {
  it("shows skeleton when loading", () => {
    render(
      <MetricChart data={{}} metrics={["sleep_score"]} isLoading={true} />,
    );

    expect(screen.getByTestId("chart-skeleton")).toBeInTheDocument();
  });

  it("shows empty state when no data", () => {
    render(
      <MetricChart data={{}} metrics={["sleep_score"]} isLoading={false} />,
    );

    expect(screen.getByTestId("chart-empty")).toBeInTheDocument();
    expect(
      screen.getByText("No data available for this period"),
    ).toBeInTheDocument();
  });

  it("renders chart with data", () => {
    render(
      <MetricChart
        data={MOCK_DATA}
        metrics={["sleep_score"]}
        isLoading={false}
      />,
    );

    expect(screen.getByTestId("metric-chart")).toBeInTheDocument();
    expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
    expect(screen.getByTestId("composed-chart")).toBeInTheDocument();
  });

  it("renders with multiple overlay metrics", () => {
    render(
      <MetricChart
        data={MOCK_DATA}
        metrics={["sleep_score", "hrv"]}
        isLoading={false}
      />,
    );

    expect(screen.getByTestId("metric-chart")).toBeInTheDocument();
    // Legend should show for overlay
    expect(screen.getByTestId("legend")).toBeInTheDocument();
  });

  it("shows empty state when metrics array is empty", () => {
    render(<MetricChart data={MOCK_DATA} metrics={[]} isLoading={false} />);

    expect(screen.getByTestId("chart-empty")).toBeInTheDocument();
  });
});
