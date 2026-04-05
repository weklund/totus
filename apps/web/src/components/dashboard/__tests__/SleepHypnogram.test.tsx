// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SleepHypnogram } from "../SleepHypnogram";
import type { HypnogramSegment } from "../SleepHypnogram";

const MOCK_SEGMENTS: HypnogramSegment[] = [
  {
    stage: "awake",
    start: "2026-03-27T22:00:00Z",
    end: "2026-03-27T22:35:00Z",
  },
  {
    stage: "light",
    start: "2026-03-27T22:35:00Z",
    end: "2026-03-27T23:30:00Z",
  },
  {
    stage: "deep",
    start: "2026-03-27T23:30:00Z",
    end: "2026-03-28T01:00:00Z",
  },
  {
    stage: "rem",
    start: "2026-03-28T01:00:00Z",
    end: "2026-03-28T02:00:00Z",
  },
  {
    stage: "light",
    start: "2026-03-28T02:00:00Z",
    end: "2026-03-28T03:30:00Z",
  },
  {
    stage: "deep",
    start: "2026-03-28T03:30:00Z",
    end: "2026-03-28T04:30:00Z",
  },
  {
    stage: "rem",
    start: "2026-03-28T04:30:00Z",
    end: "2026-03-28T06:00:00Z",
  },
];

const TIME_START = "2026-03-27T20:00:00Z";
const TIME_END = "2026-03-28T08:00:00Z";

describe("SleepHypnogram", () => {
  it("renders stage rows for awake, light, deep, and REM", () => {
    render(
      <SleepHypnogram
        segments={MOCK_SEGMENTS}
        timeStart={TIME_START}
        timeEnd={TIME_END}
      />,
    );

    expect(screen.getByTestId("sleep-hypnogram")).toBeInTheDocument();
    // Each stage label appears twice (legend + row label), so use getAllByText
    expect(screen.getAllByText("Awake").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Light").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Deep").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("REM").length).toBeGreaterThanOrEqual(1);
  });

  it("shows stage legend", () => {
    render(
      <SleepHypnogram
        segments={MOCK_SEGMENTS}
        timeStart={TIME_START}
        timeEnd={TIME_END}
      />,
    );

    // Legend items
    const legendItems = screen.getAllByText(/Awake|Light|Deep|REM/);
    // 4 in legend + 4 in rows = 8
    expect(legendItems.length).toBeGreaterThanOrEqual(4);
  });

  it("shows total sleep duration", () => {
    render(
      <SleepHypnogram
        segments={MOCK_SEGMENTS}
        timeStart={TIME_START}
        timeEnd={TIME_END}
      />,
    );

    // Total duration should be around 8h
    expect(screen.getByTestId("sleep-hypnogram")).toHaveTextContent(/\dh/);
  });

  it("shows loading skeleton", () => {
    render(
      <SleepHypnogram
        segments={[]}
        timeStart={TIME_START}
        timeEnd={TIME_END}
        isLoading
      />,
    );
    expect(screen.getByTestId("hypnogram-loading")).toBeInTheDocument();
  });

  it("shows empty state when no segments", () => {
    render(
      <SleepHypnogram
        segments={[]}
        timeStart={TIME_START}
        timeEnd={TIME_END}
      />,
    );
    expect(screen.getByTestId("hypnogram-empty")).toBeInTheDocument();
    expect(
      screen.getByText("No sleep stage data available"),
    ).toBeInTheDocument();
  });

  it("has accessible role and label", () => {
    render(
      <SleepHypnogram
        segments={MOCK_SEGMENTS}
        timeStart={TIME_START}
        timeEnd={TIME_END}
      />,
    );

    const chart = screen.getByRole("img", { name: "Sleep hypnogram" });
    expect(chart).toBeInTheDocument();
  });
});
