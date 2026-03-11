"use client";

import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { getMetricColor } from "@/lib/chart-utils";
import { getMetricType } from "@/config/metrics";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartTooltip } from "./ChartTooltip";
import type { HealthDataMetric } from "@/hooks/useHealthData";

interface MetricChartProps {
  /** Metric data keyed by metric type */
  data: Record<string, HealthDataMetric>;
  /** Which metrics to display (1-3 for overlay) */
  metrics: string[];
  /** Chart height in pixels */
  height?: number;
  /** Whether to show the chart in compact mode (no axis labels) */
  compact?: boolean;
  /** Whether the chart is in a loading state */
  isLoading?: boolean;
}

export function MetricChart({
  data,
  metrics,
  height = 300,
  compact = false,
  isLoading = false,
}: MetricChartProps) {
  // Transform API data into Recharts format (merge by date)
  const chartData = useMemo(() => {
    if (!data || metrics.length === 0) return [];

    const dateMap = new Map<string, Record<string, number>>();
    for (const metric of metrics) {
      const metricData = data[metric];
      if (!metricData) continue;
      for (const point of metricData.points) {
        const existing = dateMap.get(point.date) || {};
        existing[metric] = point.value;
        dateMap.set(point.date, existing);
      }
    }

    return Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => ({ date, ...values }));
  }, [data, metrics]);

  if (isLoading) {
    return (
      <Skeleton
        className="w-full rounded-lg"
        style={{ height }}
        data-testid="chart-skeleton"
      />
    );
  }

  if (chartData.length === 0) {
    return (
      <div
        className="text-muted-foreground flex items-center justify-center rounded-lg border border-dashed"
        style={{ height }}
        data-testid="chart-empty"
      >
        <p className="text-sm">No data available for this period</p>
      </div>
    );
  }

  const isOverlay = metrics.length > 1;

  return (
    <div data-testid="metric-chart">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={chartData}
          margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => {
              try {
                return format(parseISO(d), "MMM d");
              } catch {
                return d;
              }
            }}
            tick={{ fontSize: 11, fill: "var(--chart-axis-label)" }}
            stroke="var(--chart-grid)"
          />
          {metrics.map((metric, i) => {
            const config = getMetricType(metric);
            return (
              <YAxis
                key={metric}
                yAxisId={isOverlay ? `y-${i}` : "y-0"}
                orientation={i === 0 ? "left" : "right"}
                label={
                  !compact
                    ? {
                        value: config?.unit ?? "",
                        angle: -90,
                        position: "insideLeft",
                        style: {
                          fontSize: 11,
                          textAnchor: "middle",
                          fill: "var(--chart-axis-label)",
                        },
                      }
                    : undefined
                }
                tick={{ fontSize: 11, fill: "var(--chart-axis-label)" }}
                stroke="var(--chart-grid)"
                width={compact ? 30 : 50}
              />
            );
          })}
          <Tooltip content={<ChartTooltip metrics={metrics} />} />
          {isOverlay && (
            <Legend
              formatter={(value: string) => {
                const config = getMetricType(value);
                return (
                  <span className="text-xs">{config?.label ?? value}</span>
                );
              }}
            />
          )}
          {metrics.map((metric, i) => {
            const color = getMetricColor(metric);
            return (
              <Line
                key={metric}
                yAxisId={isOverlay ? `y-${i}` : "y-0"}
                type="monotone"
                dataKey={metric}
                stroke={color.line}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls
                name={metric}
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
