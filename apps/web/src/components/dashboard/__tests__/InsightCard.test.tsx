// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InsightCard } from "../InsightCard";
import type { Insight } from "@/lib/dashboard/types";

const MOCK_INSIGHT: Insight = {
  type: "elevated_rhr",
  title: "Elevated Resting Heart Rate",
  body: "Your resting HR was 11 bpm above your 30-day average. Sleep onset took 35 min.",
  related_metrics: ["rhr", "sleep_latency", "deep_sleep"],
  severity: "warning",
  dismissible: true,
};

const INFO_INSIGHT: Insight = {
  type: "low_sleep_score",
  title: "Low Sleep Score",
  body: "Your sleep score was 19 points below average.",
  related_metrics: ["sleep_score"],
  severity: "info",
  dismissible: true,
};

describe("InsightCard", () => {
  it("renders narrative title and body text", () => {
    render(<InsightCard insight={MOCK_INSIGHT} />);
    expect(screen.getByTestId("insight-card")).toBeInTheDocument();
    expect(screen.getByText("Elevated Resting Heart Rate")).toBeInTheDocument();
    expect(
      screen.getByText(/Your resting HR was 11 bpm above/),
    ).toBeInTheDocument();
  });

  it("shows severity badge with correct variant", () => {
    render(<InsightCard insight={MOCK_INSIGHT} />);
    const badge = screen.getByTestId("insight-severity");
    expect(badge).toHaveTextContent("warning");
  });

  it("shows info severity badge for info-level insight", () => {
    render(<InsightCard insight={INFO_INSIGHT} />);
    const badge = screen.getByTestId("insight-severity");
    expect(badge).toHaveTextContent("info");
  });

  it("shows related metrics tags", () => {
    render(<InsightCard insight={MOCK_INSIGHT} />);
    const tags = screen.getAllByTestId("insight-metric-tag");
    expect(tags).toHaveLength(3);
    expect(tags[0]).toHaveTextContent("rhr");
    expect(tags[1]).toHaveTextContent("sleep latency");
    expect(tags[2]).toHaveTextContent("deep sleep");
  });

  it("shows dismiss button when dismissible + onDismiss provided", () => {
    const onDismiss = vi.fn();
    render(<InsightCard insight={MOCK_INSIGHT} onDismiss={onDismiss} />);
    expect(screen.getByTestId("insight-dismiss")).toBeInTheDocument();
  });

  it("calls onDismiss with insight type when dismiss clicked", () => {
    const onDismiss = vi.fn();
    render(<InsightCard insight={MOCK_INSIGHT} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId("insight-dismiss"));
    expect(onDismiss).toHaveBeenCalledWith("elevated_rhr");
  });

  it("does not show dismiss button when not dismissible", () => {
    const nonDismissible = { ...MOCK_INSIGHT, dismissible: false };
    const onDismiss = vi.fn();
    render(<InsightCard insight={nonDismissible} onDismiss={onDismiss} />);
    expect(screen.queryByTestId("insight-dismiss")).not.toBeInTheDocument();
  });

  it("has accessible aria-label on the card", () => {
    render(<InsightCard insight={MOCK_INSIGHT} />);
    const card = screen.getByTestId("insight-card");
    expect(card).toHaveAttribute(
      "aria-label",
      "Insight: Elevated Resting Heart Rate",
    );
  });

  it("dismiss button is keyboard-focusable", () => {
    const onDismiss = vi.fn();
    render(<InsightCard insight={MOCK_INSIGHT} onDismiss={onDismiss} />);
    const btn = screen.getByTestId("insight-dismiss");
    expect(btn).toHaveAttribute(
      "aria-label",
      "Dismiss insight: Elevated Resting Heart Rate",
    );
    // Button element is natively focusable
    btn.focus();
    expect(document.activeElement).toBe(btn);
  });
});
