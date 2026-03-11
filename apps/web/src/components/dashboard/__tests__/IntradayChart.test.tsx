// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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
  ReferenceLine: ({ label }: { label?: { value: string } }) => (
    <div data-testid="reference-line">{label?.value}</div>
  ),
}));

import { IntradayChart } from "../IntradayChart";

const MOCK_READINGS = [
  { recorded_at: "2026-01-01T08:00:00Z", value: 72 },
  { recorded_at: "2026-01-01T08:05:00Z", value: 75 },
  { recorded_at: "2026-01-01T08:10:00Z", value: 68 },
  { recorded_at: "2026-01-01T08:15:00Z", value: 71 },
];

describe("IntradayChart", () => {
  it("shows loading skeleton when isLoading is true", () => {
    render(
      <IntradayChart
        metricType="heart_rate"
        source="oura"
        readings={[]}
        isLoading={true}
      />,
    );

    expect(screen.getByTestId("intraday-chart-loading")).toBeInTheDocument();
  });

  it("shows empty state when no readings", () => {
    render(
      <IntradayChart
        metricType="heart_rate"
        source="oura"
        readings={[]}
        isLoading={false}
      />,
    );

    expect(screen.getByTestId("intraday-chart-empty")).toBeInTheDocument();
    expect(screen.getByText(/no intraday data/i)).toBeInTheDocument();
  });

  it("renders chart with readings", () => {
    render(
      <IntradayChart
        metricType="heart_rate"
        source="oura"
        readings={MOCK_READINGS}
        isLoading={false}
      />,
    );

    expect(screen.getByTestId("intraday-chart")).toBeInTheDocument();
    expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
    expect(screen.getByTestId("area-chart")).toBeInTheDocument();
  });

  it("shows source badge with provider name", () => {
    render(
      <IntradayChart
        metricType="heart_rate"
        source="oura"
        readings={MOCK_READINGS}
        isLoading={false}
      />,
    );

    expect(screen.getByTestId("source-badge-oura")).toBeInTheDocument();
  });

  it("shows metric label in header", () => {
    render(
      <IntradayChart
        metricType="heart_rate"
        source="oura"
        readings={MOCK_READINGS}
        isLoading={false}
      />,
    );

    expect(screen.getByText(/Heart Rate/)).toBeInTheDocument();
  });

  it("renders glucose reference lines", () => {
    const glucoseReadings = [
      { recorded_at: "2026-01-01T08:00:00Z", value: 95 },
      { recorded_at: "2026-01-01T08:05:00Z", value: 110 },
    ];

    render(
      <IntradayChart
        metricType="glucose"
        source="dexcom"
        readings={glucoseReadings}
        isLoading={false}
      />,
    );

    const refLines = screen.getAllByTestId("reference-line");
    expect(refLines.length).toBe(2);
    expect(screen.getByText("Low")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
  });
});
