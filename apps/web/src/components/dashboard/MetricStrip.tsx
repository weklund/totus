"use client";

import { useState, useMemo } from "react";
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
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { BaselineBand } from "./BaselineBand";
import { DeltaBadge } from "./DeltaBadge";
import type { BaselinePayload, SummaryMetric } from "@/lib/dashboard/types";

export interface MetricStripDataPoint {
  /** ISO timestamp or date string */
  timestamp: string;
  /** Numeric value */
  value: number;
}

interface MetricStripProps {
  /** Metric type identifier */
  metricType: string;
  /** Data points (timestamps + values) */
  data: MetricStripDataPoint[];
  /** Baseline statistics for normal range band */
  baseline?: BaselinePayload | null;
  /** Summary metric with delta/direction/status */
  summary?: SummaryMetric | null;
  /** Whether the strip is loading */
  isLoading?: boolean;
  /** Height of the collapsed sparkline in pixels */
  collapsedHeight?: number;
  /** Height of the expanded chart in pixels */
  expandedHeight?: number;
  /** X-axis tick formatter — shared from MetricStripContainer */
  formatXAxis?: (timestamp: string | number) => string;
  /** X-axis domain — shared from MetricStripContainer for alignment */
  xDomain?: [number, number];
}

/**
 * MetricStrip — Recharts-based compact sparkline with BaselineBand overlay,
 * expand/collapse on header click, metric label, current value, and unit.
 *
 * Collapsed: compact sparkline for scanning (stacks 4+ strips).
 * Expanded: full chart with Y-axis labels, grid lines, data-point markers.
 *
 * See: wireframes W1-W3, W6 in /docs/design/wireframes.md
 */
export function MetricStrip({
  metricType,
  data,
  baseline,
  summary,
  isLoading = false,
  collapsedHeight = 80,
  expandedHeight = 200,
  formatXAxis,
  xDomain,
}: MetricStripProps) {
  const [expanded, setExpanded] = useState(false);
  const config = getMetricType(metricType);
  const color = getMetricColor(metricType);
  const label = config?.label ?? metricType;
  const unit = config?.unit ?? "";

  // When xDomain is provided (numeric epoch ms from MetricStripContainer),
  // convert timestamps to epoch ms for consistent Recharts domain/range alignment.
  // Otherwise, keep the original string timestamps for non-aligned rendering.
  const useNumericAxis = !!xDomain;
  const chartData = useMemo(
    () =>
      data.map((d) => ({
        timestamp: useNumericAxis
          ? new Date(d.timestamp).getTime()
          : (d.timestamp as string | number),
        value: d.value,
      })),
    [data, useNumericAxis],
  );

  const currentValue = data.length > 0 ? data[data.length - 1].value : null;
  const height = expanded ? expandedHeight : collapsedHeight;

  if (isLoading) {
    return (
      <div data-testid="metric-strip-loading">
        <Skeleton className="mb-1 h-4 w-40" />
        <Skeleton
          className="w-full rounded-lg"
          style={{ height: collapsedHeight }}
        />
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div
        className="text-muted-foreground flex items-center justify-center rounded-lg border border-dashed"
        style={{ height: collapsedHeight }}
        data-testid="metric-strip-empty"
      >
        <p className="text-sm">No {label.toLowerCase()} data</p>
      </div>
    );
  }

  const defaultFormatter = (ts: string | number): string => {
    try {
      const d = typeof ts === "number" ? new Date(ts) : parseISO(ts);
      return format(d, "HH:mm");
    } catch {
      return String(ts);
    }
  };

  const tickFormatter = formatXAxis ?? defaultFormatter;

  return (
    <div data-testid="metric-strip" className="group">
      {/* Header — click to expand/collapse */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="mb-1 flex w-full cursor-pointer items-center justify-between text-left"
        aria-expanded={expanded}
        aria-label={`${label} chart, click to ${expanded ? "collapse" : "expand"}`}
        data-testid="metric-strip-header"
      >
        <div className="flex items-center gap-2">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: color.line }}
            aria-hidden="true"
          />
          <span className="text-xs font-medium">{label}</span>
          {currentValue !== null && (
            <span className="text-muted-foreground text-xs">
              {formatValue(currentValue)} {unit}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {summary && (
            <DeltaBadge
              delta={summary.delta}
              direction={summary.direction}
              unit={unit}
              metricLabel={label}
              compact
            />
          )}
          <span
            className={cn(
              "text-muted-foreground text-[10px] transition-transform",
              expanded && "rotate-180",
            )}
            aria-hidden="true"
          >
            ▾
          </span>
        </div>
      </button>

      {/* Chart */}
      <div
        className="overflow-hidden transition-[height] duration-200 ease-in-out"
        style={{ height }}
      >
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart
            data={chartData}
            margin={{
              top: 4,
              right: 8,
              bottom: 4,
              left: expanded ? 0 : -20,
            }}
          >
            {expanded && (
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
            )}
            <XAxis
              dataKey="timestamp"
              tickFormatter={tickFormatter}
              tick={{ fontSize: 10, fill: "var(--chart-axis-label)" }}
              stroke="var(--chart-grid)"
              minTickGap={40}
              {...(xDomain
                ? {
                    type: "number" as const,
                    domain: xDomain,
                    scale: "time" as const,
                  }
                : {})}
            />
            <YAxis
              yAxisId="y-0"
              tick={
                expanded
                  ? { fontSize: 10, fill: "var(--chart-axis-label)" }
                  : false
              }
              stroke="var(--chart-grid)"
              width={expanded ? 40 : 0}
              domain={["auto", "auto"]}
            />
            {expanded && (
              <Tooltip
                content={
                  <StripTooltip
                    metricType={metricType}
                    formatTime={tickFormatter}
                  />
                }
              />
            )}
            {baseline && (
              <BaselineBand baseline={baseline} metricType={metricType} />
            )}
            {baseline && (
              <ReferenceLine
                y={baseline.avg_30d}
                yAxisId="y-0"
                stroke={color.line}
                strokeDasharray="4 4"
                strokeOpacity={0.5}
              />
            )}
            <Area
              yAxisId="y-0"
              type="monotone"
              dataKey="value"
              stroke={color.line}
              fill={color.fill}
              strokeWidth={expanded ? 2 : 1.5}
              dot={expanded ? { r: 2, fill: color.line } : false}
              activeDot={expanded ? { r: 4 } : false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────

function formatValue(v: number): string {
  return v % 1 === 0 ? v.toString() : v.toFixed(1);
}

interface StripTooltipProps {
  metricType: string;
  formatTime: (ts: string | number) => string;
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string | number;
}

function StripTooltip({
  metricType,
  formatTime,
  active,
  payload,
  label,
}: StripTooltipProps) {
  if (!active || !payload?.length || label == null) return null;

  const config = getMetricType(metricType);
  const value = payload[0].value;

  return (
    <div
      className="rounded-lg border p-2 shadow-md"
      style={{
        backgroundColor: "var(--chart-tooltip-bg)",
        borderColor: "var(--chart-tooltip-border)",
        color: "var(--chart-tooltip-text)",
      }}
    >
      <p className="mb-1 text-[10px] font-medium">{formatTime(label)}</p>
      <p className="text-xs">
        <span className="font-medium">{formatValue(value)}</span>{" "}
        <span className="text-muted-foreground">{config?.unit ?? ""}</span>
      </p>
    </div>
  );
}
