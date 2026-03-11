// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PeriodTimeline } from "../PeriodTimeline";

const MOCK_SLEEP_STAGES = [
  {
    subtype: "deep",
    started_at: "2026-01-01T23:00:00Z",
    ended_at: "2026-01-01T23:45:00Z",
    duration_sec: 2700,
    source: "oura",
  },
  {
    subtype: "rem",
    started_at: "2026-01-01T23:45:00Z",
    ended_at: "2026-01-02T00:30:00Z",
    duration_sec: 2700,
    source: "oura",
  },
  {
    subtype: "light",
    started_at: "2026-01-02T00:30:00Z",
    ended_at: "2026-01-02T01:15:00Z",
    duration_sec: 2700,
    source: "oura",
  },
];

const MOCK_WORKOUTS = [
  {
    subtype: "run",
    started_at: "2026-01-01T07:00:00Z",
    ended_at: "2026-01-01T07:45:00Z",
    duration_sec: 2700,
    source: "garmin",
  },
  {
    subtype: "strength",
    started_at: "2026-01-02T18:00:00Z",
    ended_at: "2026-01-02T19:00:00Z",
    duration_sec: 3600,
    source: "garmin",
  },
];

describe("PeriodTimeline", () => {
  it("shows loading skeleton when isLoading is true", () => {
    render(
      <PeriodTimeline eventType="sleep_stage" periods={[]} isLoading={true} />,
    );

    expect(screen.getByTestId("period-timeline-loading")).toBeInTheDocument();
  });

  it("shows empty state when no periods", () => {
    render(
      <PeriodTimeline eventType="sleep_stage" periods={[]} isLoading={false} />,
    );

    expect(screen.getByTestId("period-timeline-empty")).toBeInTheDocument();
    expect(screen.getByText(/no sleep stages data/i)).toBeInTheDocument();
  });

  it("renders sleep stage hypnogram with colored bars", () => {
    render(
      <PeriodTimeline
        eventType="sleep_stage"
        periods={MOCK_SLEEP_STAGES}
        isLoading={false}
      />,
    );

    expect(screen.getByTestId("period-timeline")).toBeInTheDocument();
    // Should show legend items
    expect(screen.getByText("REM")).toBeInTheDocument();
    expect(screen.getByText("Deep")).toBeInTheDocument();
    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getByText("Awake")).toBeInTheDocument();
  });

  it("renders workout event cards", () => {
    render(
      <PeriodTimeline
        eventType="workout"
        periods={MOCK_WORKOUTS}
        isLoading={false}
      />,
    );

    expect(screen.getByTestId("period-timeline")).toBeInTheDocument();
    const eventCards = screen.getAllByTestId("period-event-workout");
    expect(eventCards).toHaveLength(2);
  });

  it("shows source badge on timeline", () => {
    render(
      <PeriodTimeline
        eventType="sleep_stage"
        periods={MOCK_SLEEP_STAGES}
        isLoading={false}
      />,
    );

    expect(screen.getByTestId("source-badge-oura")).toBeInTheDocument();
  });

  it("renders workout subtypes", () => {
    render(
      <PeriodTimeline
        eventType="workout"
        periods={MOCK_WORKOUTS}
        isLoading={false}
      />,
    );

    expect(screen.getByText("run")).toBeInTheDocument();
    expect(screen.getByText("strength")).toBeInTheDocument();
  });

  it("shows duration for workout events", () => {
    render(
      <PeriodTimeline
        eventType="workout"
        periods={MOCK_WORKOUTS}
        isLoading={false}
      />,
    );

    expect(screen.getByText("45m")).toBeInTheDocument();
    expect(screen.getByText("1h 0m")).toBeInTheDocument();
  });
});
