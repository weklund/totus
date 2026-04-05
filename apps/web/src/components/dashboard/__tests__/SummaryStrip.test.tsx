// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SummaryStrip } from "../SummaryStrip";
import type { SummaryMetric } from "@/lib/dashboard/types";

const MOCK_SUMMARY: Record<string, SummaryMetric> = {
  sleep_score: {
    value: 64,
    avg_30d: 83,
    stddev_30d: 6,
    delta: -19,
    delta_pct: -22.9,
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
  hrv: {
    value: 32,
    avg_30d: 44,
    stddev_30d: 6,
    delta: -12,
    delta_pct: -27.3,
    direction: "worse",
    status: "warning",
  },
  rhr: {
    value: 72,
    avg_30d: 61,
    stddev_30d: 5,
    delta: 11,
    delta_pct: 18,
    direction: "worse",
    status: "critical",
  },
};

describe("SummaryStrip", () => {
  it("renders all summary metrics", () => {
    render(<SummaryStrip summary={MOCK_SUMMARY} />);
    expect(screen.getByTestId("summary-strip")).toBeInTheDocument();
    const items = screen.getAllByTestId("summary-metric");
    expect(items).toHaveLength(4);
  });

  it("shows metric labels", () => {
    render(<SummaryStrip summary={MOCK_SUMMARY} />);
    expect(screen.getByText("Sleep Score")).toBeInTheDocument();
    expect(screen.getByText("Deep Sleep")).toBeInTheDocument();
    expect(screen.getByText("Heart Rate Variability")).toBeInTheDocument();
    expect(screen.getByText("Resting Heart Rate")).toBeInTheDocument();
  });

  it("shows metric values in the summary cells", () => {
    render(<SummaryStrip summary={MOCK_SUMMARY} />);
    const items = screen.getAllByTestId("summary-metric");
    // Check that each metric cell contains its value
    expect(items[0]).toHaveTextContent("64");
    expect(items[1]).toHaveTextContent("0.8");
    expect(items[2]).toHaveTextContent("32");
    expect(items[3]).toHaveTextContent("72");
  });

  it("shows delta badges with correct polarity colors", () => {
    render(<SummaryStrip summary={MOCK_SUMMARY} />);
    const badges = screen.getAllByTestId("delta-badge");
    expect(badges).toHaveLength(4);

    // All are "worse" → should have coral color
    for (const badge of badges) {
      expect(badge).toHaveClass("text-[#E8845A]");
    }
  });

  it("respects metrics order when provided", () => {
    render(
      <SummaryStrip
        summary={MOCK_SUMMARY}
        metrics={["rhr", "hrv", "sleep_score"]}
      />,
    );
    const items = screen.getAllByTestId("summary-metric");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Resting Heart Rate");
    expect(items[1]).toHaveTextContent("Heart Rate Variability");
    expect(items[2]).toHaveTextContent("Sleep Score");
  });

  it("shows loading skeleton when isLoading is true", () => {
    render(<SummaryStrip summary={{}} isLoading />);
    expect(screen.getByTestId("summary-strip-loading")).toBeInTheDocument();
  });

  it("returns null when no metrics to display", () => {
    const { container } = render(<SummaryStrip summary={{}} />);
    expect(container.firstChild).toBeNull();
  });
});
