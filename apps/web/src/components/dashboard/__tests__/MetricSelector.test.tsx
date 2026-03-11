// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MetricSelector } from "../MetricSelector";
import type { HealthDataType } from "@/hooks/useHealthDataTypes";

const MOCK_METRICS: HealthDataType[] = [
  {
    metric_type: "sleep_score",
    label: "Sleep Score",
    unit: "score",
    category: "sleep",
    source: "oura",
    date_range: { start: "2026-01-01", end: "2026-03-01" },
    count: 90,
  },
  {
    metric_type: "hrv",
    label: "Heart Rate Variability",
    unit: "ms",
    category: "cardiovascular",
    source: "oura",
    date_range: { start: "2026-01-01", end: "2026-03-01" },
    count: 90,
  },
  {
    metric_type: "rhr",
    label: "Resting Heart Rate",
    unit: "bpm",
    category: "cardiovascular",
    source: "oura",
    date_range: { start: "2026-01-01", end: "2026-03-01" },
    count: 90,
  },
  {
    metric_type: "steps",
    label: "Steps",
    unit: "steps",
    category: "activity",
    source: "oura",
    date_range: { start: "2026-01-01", end: "2026-03-01" },
    count: 90,
  },
  {
    metric_type: "readiness_score",
    label: "Readiness Score",
    unit: "score",
    category: "recovery",
    source: "oura",
    date_range: { start: "2026-01-01", end: "2026-03-01" },
    count: 90,
  },
];

describe("MetricSelector", () => {
  it("renders metric chips grouped by category", () => {
    render(
      <MetricSelector
        availableMetrics={MOCK_METRICS}
        selectedMetrics={[]}
        onSelectionChange={() => {}}
      />,
    );

    expect(screen.getByText("sleep")).toBeInTheDocument();
    expect(screen.getByText("cardiovascular")).toBeInTheDocument();
    expect(screen.getByText("activity")).toBeInTheDocument();
    expect(screen.getByText("Sleep Score")).toBeInTheDocument();
    expect(screen.getByText("Heart Rate Variability")).toBeInTheDocument();
    expect(screen.getByText("Steps")).toBeInTheDocument();
  });

  it("shows selected state for selected metrics", () => {
    render(
      <MetricSelector
        availableMetrics={MOCK_METRICS}
        selectedMetrics={["sleep_score", "hrv"]}
        onSelectionChange={() => {}}
      />,
    );

    const sleepChip = screen.getByTestId("metric-chip-sleep_score");
    const stepsChip = screen.getByTestId("metric-chip-steps");

    // Selected chips get inline background color style
    expect(sleepChip.style.backgroundColor).toBeTruthy();
    // Unselected chips should not have inline background
    expect(stepsChip.style.backgroundColor).toBeFalsy();
  });

  it("calls onSelectionChange when toggling metrics", () => {
    const onChange = vi.fn();
    render(
      <MetricSelector
        availableMetrics={MOCK_METRICS}
        selectedMetrics={["sleep_score"]}
        onSelectionChange={onChange}
      />,
    );

    // Add a metric
    fireEvent.click(screen.getByTestId("metric-chip-hrv"));
    expect(onChange).toHaveBeenCalledWith(["sleep_score", "hrv"]);

    // Remove a metric
    onChange.mockClear();
    fireEvent.click(screen.getByTestId("metric-chip-sleep_score"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("disables unselected chips when maxSelection reached", () => {
    render(
      <MetricSelector
        availableMetrics={MOCK_METRICS}
        selectedMetrics={["sleep_score", "hrv", "steps"]}
        onSelectionChange={() => {}}
        maxSelection={3}
      />,
    );

    const rhrChip = screen.getByTestId("metric-chip-rhr");
    expect(rhrChip).toBeDisabled();
    expect(rhrChip).toHaveAttribute("title", "Maximum 3 metrics selected");
  });

  it("allows deselecting when maxSelection reached", () => {
    const onChange = vi.fn();
    render(
      <MetricSelector
        availableMetrics={MOCK_METRICS}
        selectedMetrics={["sleep_score", "hrv", "steps"]}
        onSelectionChange={onChange}
        maxSelection={3}
      />,
    );

    // Should still be able to deselect
    fireEvent.click(screen.getByTestId("metric-chip-sleep_score"));
    expect(onChange).toHaveBeenCalledWith(["hrv", "steps"]);
  });

  it("shows count badge on chips", () => {
    render(
      <MetricSelector
        availableMetrics={MOCK_METRICS}
        selectedMetrics={[]}
        onSelectionChange={() => {}}
      />,
    );

    // Each chip should show its data count
    expect(screen.getAllByText("90")).toHaveLength(5);
  });
});
