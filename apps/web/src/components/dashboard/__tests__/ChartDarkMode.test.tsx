// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// Mock recharts to capture props passed to chart components
const CartesianGridMock = vi.fn((_props: Record<string, unknown>) => null);
const XAxisMock = vi.fn((_props: Record<string, unknown>) => null);
const YAxisMock = vi.fn((_props: Record<string, unknown>) => null);
const TooltipMock = vi.fn((_props: Record<string, unknown>) => null);

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  ComposedChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="composed-chart">{children}</div>
  ),
  Line: () => <div data-testid="chart-line" />,
  XAxis: (props: Record<string, unknown>) => {
    XAxisMock(props);
    return <div data-testid="x-axis" />;
  },
  YAxis: (props: Record<string, unknown>) => {
    YAxisMock(props);
    return <div data-testid="y-axis" />;
  },
  CartesianGrid: (props: Record<string, unknown>) => {
    CartesianGridMock(props);
    return <div data-testid="cartesian-grid" />;
  },
  Tooltip: (props: Record<string, unknown>) => {
    TooltipMock(props);
    return <div data-testid="tooltip" />;
  },
  Legend: () => <div data-testid="legend" />,
}));

import { MetricChart } from "../MetricChart";

const MOCK_DATA = {
  sleep_score: {
    unit: "score",
    points: [
      { date: "2026-01-01", value: 85, source: "oura" },
      { date: "2026-01-02", value: 78, source: "oura" },
    ],
  },
};

describe("Chart Dark Mode Support", () => {
  it("CartesianGrid uses CSS custom property for stroke", () => {
    CartesianGridMock.mockClear();

    render(
      <MetricChart
        data={MOCK_DATA}
        metrics={["sleep_score"]}
        isLoading={false}
      />,
    );

    expect(CartesianGridMock).toHaveBeenCalled();
    const gridProps = CartesianGridMock.mock.calls[0][0];
    expect(gridProps.stroke).toBe("var(--chart-grid)");
  });

  it("XAxis uses CSS custom property for tick fill and stroke", () => {
    XAxisMock.mockClear();

    render(
      <MetricChart
        data={MOCK_DATA}
        metrics={["sleep_score"]}
        isLoading={false}
      />,
    );

    expect(XAxisMock).toHaveBeenCalled();
    const xAxisProps = XAxisMock.mock.calls[0][0];
    expect(xAxisProps.tick).toEqual(
      expect.objectContaining({ fill: "var(--chart-axis-label)" }),
    );
    expect(xAxisProps.stroke).toBe("var(--chart-grid)");
  });

  it("YAxis uses CSS custom property for tick fill and stroke", () => {
    YAxisMock.mockClear();

    render(
      <MetricChart
        data={MOCK_DATA}
        metrics={["sleep_score"]}
        isLoading={false}
      />,
    );

    expect(YAxisMock).toHaveBeenCalled();
    const yAxisProps = YAxisMock.mock.calls[0][0];
    expect(yAxisProps.tick).toEqual(
      expect.objectContaining({ fill: "var(--chart-axis-label)" }),
    );
    expect(yAxisProps.stroke).toBe("var(--chart-grid)");
  });

  it("ChartTooltip uses CSS custom properties for styling", async () => {
    const { ChartTooltip } = await import("../ChartTooltip");

    const { container } = render(
      <ChartTooltip
        metrics={["sleep_score"]}
        active={true}
        payload={[{ dataKey: "sleep_score", value: 85 }]}
        label="2026-01-01"
      />,
    );

    const tooltipDiv = container.firstElementChild;
    expect(tooltipDiv).toBeTruthy();

    // Check that CSS custom properties are used for theming
    const style = tooltipDiv?.getAttribute("style") ?? "";
    expect(style).toContain("--chart-tooltip-bg");
    expect(style).toContain("--chart-tooltip-border");
    expect(style).toContain("--chart-tooltip-text");
  });
});
