"use client";

import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { getMetricColor } from "@/lib/chart-utils";
import { getMetricType } from "@/config/metrics";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceBadge } from "./SourceBadge";
import type { SeriesReading } from "@/hooks/useSeriesData";

interface IntradayChartProps {
  /** Metric type identifier (e.g., 'heart_rate', 'glucose') */
  metricType: string;
  /** Provider source for this data */
  source: string;
  /** High-frequency readings with timestamps */
  readings: SeriesReading[];
  /** Chart height in pixels */
  height?: number;
  /** Whether the chart is loading */
  isLoading?: boolean;
}

/**
 * IntradayChart — time-series chart for high-frequency intraday data.
 *
 * Renders minute-level data (heart rate, glucose, SpO2 intervals) using
 * Recharts AreaChart. Includes loading skeleton and empty state.
 *
 * For glucose, adds reference lines at clinical thresholds (70 and 180 mg/dL).
 *
 * See: /docs/web-ui-lld.md Section 8.5
 */
export function IntradayChart({
  metricType,
  source,
  readings,
  height = 250,
  isLoading = false,
}: IntradayChartProps) {
  const config = getMetricType(metricType);
  const color = getMetricColor(metricType);

  // Downsample if too many points for smooth rendering
  const chartData = useMemo(() => {
    if (!readings || readings.length === 0) return [];

    // If more than 500 points, downsample to hourly averages
    if (readings.length > 500) {
      return downsampleToHourly(readings);
    }

    return readings.map((r) => ({
      time: r.recorded_at,
      value: r.value,
    }));
  }, [readings]);

  const isGlucose = metricType === "glucose";

  if (isLoading) {
    return (
      <div data-testid="intraday-chart-loading">
        <Skeleton className="mb-2 h-4 w-32" />
        <Skeleton className="w-full rounded-lg" style={{ height }} />
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div
        className="text-muted-foreground flex flex-col items-center justify-center rounded-lg border border-dashed"
        style={{ height }}
        data-testid="intraday-chart-empty"
      >
        <p className="text-sm">
          No intraday data available for {config?.label ?? metricType}
        </p>
      </div>
    );
  }

  return (
    <div data-testid="intraday-chart">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-muted-foreground text-xs font-medium">
          {config?.label ?? metricType}
          {config?.unit ? ` (${config.unit})` : ""}
        </h4>
        <SourceBadge provider={source} showName size="sm" />
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart
          data={chartData}
          margin={{ top: 5, right: 10, bottom: 5, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
          <XAxis
            dataKey="time"
            tickFormatter={formatTimeAxis}
            tick={{ fontSize: 10, fill: "var(--chart-axis-label)" }}
            stroke="var(--chart-grid)"
            minTickGap={40}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--chart-axis-label)" }}
            stroke="var(--chart-grid)"
            width={40}
            domain={isGlucose ? [40, "auto"] : ["auto", "auto"]}
          />
          <Tooltip content={<IntradayTooltip metricType={metricType} />} />
          {isGlucose && (
            <>
              <ReferenceLine
                y={70}
                stroke="hsl(0, 70%, 55%)"
                strokeDasharray="4 4"
                label={{ value: "Low", position: "left", fontSize: 10 }}
              />
              <ReferenceLine
                y={180}
                stroke="hsl(30, 80%, 55%)"
                strokeDasharray="4 4"
                label={{ value: "High", position: "left", fontSize: 10 }}
              />
            </>
          )}
          <Area
            type="monotone"
            dataKey="value"
            stroke={color.line}
            fill={color.fill}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────

function formatTimeAxis(timestamp: string): string {
  try {
    const d = parseISO(timestamp);
    return format(d, "HH:mm");
  } catch {
    return timestamp;
  }
}

function downsampleToHourly(
  readings: SeriesReading[],
): Array<{ time: string; value: number }> {
  const hourBuckets = new Map<string, { sum: number; count: number }>();

  for (const r of readings) {
    try {
      const d = parseISO(r.recorded_at);
      // Create bucket key: date + hour
      const key = format(d, "yyyy-MM-dd'T'HH':00:00'");
      const bucket = hourBuckets.get(key) || { sum: 0, count: 0 };
      bucket.sum += r.value;
      bucket.count += 1;
      hourBuckets.set(key, bucket);
    } catch {
      // Skip invalid timestamps
    }
  }

  return Array.from(hourBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, { sum, count }]) => ({
      time,
      value: Math.round((sum / count) * 10) / 10,
    }));
}

// ─── Custom Tooltip ────────────────────────────────────────

interface IntradayTooltipProps {
  metricType: string;
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}

function IntradayTooltip({
  metricType,
  active,
  payload,
  label,
}: IntradayTooltipProps) {
  if (!active || !payload?.length || !label) return null;

  const config = getMetricType(metricType);
  const value = payload[0].value;

  let formattedTime: string;
  try {
    formattedTime = format(parseISO(label), "MMM d, HH:mm");
  } catch {
    formattedTime = label;
  }

  return (
    <div
      className="rounded-lg border p-2 shadow-md"
      style={{
        backgroundColor: "var(--chart-tooltip-bg)",
        borderColor: "var(--chart-tooltip-border)",
        color: "var(--chart-tooltip-text)",
      }}
    >
      <p className="mb-1 text-[10px] font-medium">{formattedTime}</p>
      <p className="text-xs">
        <span className="font-medium">
          {typeof value === "number"
            ? value % 1 === 0
              ? value
              : value.toFixed(1)
            : value}
        </span>{" "}
        <span className="text-muted-foreground">{config?.unit ?? ""}</span>
      </p>
    </div>
  );
}
