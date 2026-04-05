// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeltaBadge } from "../DeltaBadge";

describe("DeltaBadge", () => {
  it("shows up arrow and coral color for worse positive delta", () => {
    render(<DeltaBadge delta={11} direction="worse" unit="bpm" />);
    const badge = screen.getByTestId("delta-badge");
    expect(badge).toHaveTextContent("▲");
    expect(badge).toHaveTextContent("11 bpm");
    expect(badge).toHaveClass("text-[#E8845A]");
  });

  it("shows down arrow and emerald color for better negative delta", () => {
    render(<DeltaBadge delta={-5} direction="better" unit="ms" />);
    const badge = screen.getByTestId("delta-badge");
    expect(badge).toHaveTextContent("▼");
    expect(badge).toHaveTextContent("5 ms");
    expect(badge).toHaveClass("text-[#2FA87B]");
  });

  it("shows slate/muted color for neutral direction", () => {
    render(<DeltaBadge delta={3} direction="neutral" unit="kg" />);
    const badge = screen.getByTestId("delta-badge");
    expect(badge).toHaveTextContent("▲");
    expect(badge).toHaveTextContent("3 kg");
    expect(badge).toHaveClass("text-muted-foreground");
  });

  it("shows 'vs avg' text by default", () => {
    render(<DeltaBadge delta={7} direction="worse" />);
    expect(screen.getByTestId("delta-badge")).toHaveTextContent("vs avg");
  });

  it("hides 'vs avg' in compact mode", () => {
    render(<DeltaBadge delta={7} direction="worse" compact />);
    expect(screen.getByTestId("delta-badge")).not.toHaveTextContent("vs avg");
  });

  it("provides accessible label when metricLabel is set", () => {
    render(
      <DeltaBadge
        delta={-19}
        direction="worse"
        unit="score"
        metricLabel="Sleep Score"
      />,
    );
    const badge = screen.getByTestId("delta-badge");
    expect(badge).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Sleep Score"),
    );
    expect(badge).toHaveAttribute(
      "aria-label",
      expect.stringContaining("down 19 score"),
    );
  });

  it("formats decimal values to 1 decimal place", () => {
    render(<DeltaBadge delta={0.8} direction="better" unit="hr" />);
    expect(screen.getByTestId("delta-badge")).toHaveTextContent("0.8 hr");
  });

  it("handles zero delta without arrow", () => {
    render(<DeltaBadge delta={0} direction="neutral" />);
    const badge = screen.getByTestId("delta-badge");
    expect(badge).not.toHaveTextContent("▲");
    expect(badge).not.toHaveTextContent("▼");
    expect(badge).toHaveTextContent("0");
  });
});
