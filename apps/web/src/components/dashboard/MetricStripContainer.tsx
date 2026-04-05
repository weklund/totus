"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { format, parseISO } from "date-fns";

interface TimeAxisContext {
  /** ISO start of the time range */
  start: string;
  /** ISO end of the time range */
  end: string;
  /** Shared X-axis tick formatter */
  formatXAxis: (timestamp: string) => string;
  /** Numeric X-axis domain for alignment [startMs, endMs] */
  xDomain?: [number, number];
}

const TimeAxisCtx = createContext<TimeAxisContext | null>(null);

/**
 * Hook to consume the shared time axis context from MetricStripContainer.
 */
export function useTimeAxis() {
  return useContext(TimeAxisCtx);
}

interface MetricStripContainerProps {
  /** Time range start (ISO string) */
  start: string;
  /** Time range end (ISO string) */
  end: string;
  /** Time axis format pattern — "time" for intraday (HH:mm), "date" for multi-day (MMM d) */
  axisMode?: "time" | "date";
  /** Children — MetricStrip instances, SleepHypnogram, AnnotationLayer */
  children: ReactNode;
}

/**
 * MetricStripContainer — shared time axis provider.
 *
 * Wraps MetricStrip instances and provides a consistent X-axis configuration
 * so all child panels share the same temporal alignment.
 *
 * See: wireframes W1-W3, W6 in /docs/design/wireframes.md
 */
export function MetricStripContainer({
  start,
  end,
  axisMode = "time",
  children,
}: MetricStripContainerProps) {
  const ctx = useMemo<TimeAxisContext>(() => {
    const formatXAxis = (timestamp: string): string => {
      try {
        const d = parseISO(timestamp);
        return axisMode === "time" ? format(d, "HH:mm") : format(d, "MMM d");
      } catch {
        return timestamp;
      }
    };

    let xDomain: [number, number] | undefined;
    try {
      xDomain = [parseISO(start).getTime(), parseISO(end).getTime()];
    } catch {
      // If dates are invalid, don't set domain
    }

    return { start, end, formatXAxis, xDomain };
  }, [start, end, axisMode]);

  return (
    <TimeAxisCtx.Provider value={ctx}>
      <div
        className="relative flex flex-col gap-3"
        data-testid="metric-strip-container"
      >
        {children}
      </div>
    </TimeAxisCtx.Provider>
  );
}
