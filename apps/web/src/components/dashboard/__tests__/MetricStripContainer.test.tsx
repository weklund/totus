// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { MetricStripContainer, useTimeAxis } from "../MetricStripContainer";

describe("MetricStripContainer", () => {
  it("renders children within the container", () => {
    render(
      <MetricStripContainer
        start="2026-03-27T20:00:00Z"
        end="2026-03-28T08:00:00Z"
      >
        <div data-testid="child-1">Strip 1</div>
        <div data-testid="child-2">Strip 2</div>
      </MetricStripContainer>,
    );

    expect(screen.getByTestId("metric-strip-container")).toBeInTheDocument();
    expect(screen.getByTestId("child-1")).toBeInTheDocument();
    expect(screen.getByTestId("child-2")).toBeInTheDocument();
  });

  it("provides time axis context to children", () => {
    function Consumer() {
      const ctx = useTimeAxis();
      if (!ctx) return <div>no context</div>;
      return (
        <div data-testid="ctx">
          {ctx.start} to {ctx.end}
        </div>
      );
    }

    render(
      <MetricStripContainer
        start="2026-03-27T20:00:00Z"
        end="2026-03-28T08:00:00Z"
      >
        <Consumer />
      </MetricStripContainer>,
    );

    expect(screen.getByTestId("ctx")).toHaveTextContent(
      "2026-03-27T20:00:00Z to 2026-03-28T08:00:00Z",
    );
  });

  it("formatXAxis returns HH:mm in time mode (default)", () => {
    function Consumer() {
      const ctx = useTimeAxis();
      if (!ctx) return <div>no context</div>;
      return (
        <div data-testid="formatted">
          {ctx.formatXAxis("2026-03-27T22:30:00Z")}
        </div>
      );
    }

    render(
      <MetricStripContainer
        start="2026-03-27T20:00:00Z"
        end="2026-03-28T08:00:00Z"
      >
        <Consumer />
      </MetricStripContainer>,
    );

    // Exact format depends on timezone but should contain time-like output
    const text = screen.getByTestId("formatted").textContent!;
    expect(text).toMatch(/\d{2}:\d{2}/);
  });

  it("formatXAxis returns MMM d in date mode", () => {
    function Consumer() {
      const ctx = useTimeAxis();
      if (!ctx) return <div>no context</div>;
      return (
        <div data-testid="formatted">
          {ctx.formatXAxis("2026-03-27T00:00:00Z")}
        </div>
      );
    }

    render(
      <MetricStripContainer
        start="2026-03-24T00:00:00Z"
        end="2026-03-28T00:00:00Z"
        axisMode="date"
      >
        <Consumer />
      </MetricStripContainer>,
    );

    expect(screen.getByTestId("formatted")).toHaveTextContent("Mar");
  });

  it("useTimeAxis returns null outside container", () => {
    const { result } = renderHook(() => useTimeAxis());
    expect(result.current).toBeNull();
  });
});
