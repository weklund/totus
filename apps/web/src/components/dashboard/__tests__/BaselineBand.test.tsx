// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock recharts to render testable DOM elements
vi.mock("recharts", () => ({
  ReferenceArea: (props: Record<string, unknown>) => (
    <div
      data-testid="reference-area"
      data-y1={props.y1}
      data-y2={props.y2}
      data-fill={props.fill}
      data-fill-opacity={props.fillOpacity}
    />
  ),
}));

import { BaselineBand } from "../BaselineBand";

describe("BaselineBand", () => {
  const baseline = {
    avg_30d: 61,
    stddev_30d: 5,
    upper: 66,
    lower: 56,
    sample_count: 30,
  };

  it("renders ReferenceArea with correct y1/y2 bounds", () => {
    render(<BaselineBand baseline={baseline} metricType="rhr" />);
    const area = screen.getByTestId("reference-area");
    expect(area).toHaveAttribute("data-y1", "56");
    expect(area).toHaveAttribute("data-y2", "66");
  });

  it("uses 12% opacity fill (≤0.15 per contract)", () => {
    render(<BaselineBand baseline={baseline} metricType="rhr" />);
    const area = screen.getByTestId("reference-area");
    expect(area).toHaveAttribute("data-fill-opacity", "0.12");
  });

  it("uses the metric color for fill", () => {
    render(<BaselineBand baseline={baseline} metricType="hrv" />);
    const area = screen.getByTestId("reference-area");
    // hrv color from chart-utils is hsl(160, 70%, 45%)
    expect(area).toHaveAttribute("data-fill", "hsl(160, 70%, 45%)");
  });
});
