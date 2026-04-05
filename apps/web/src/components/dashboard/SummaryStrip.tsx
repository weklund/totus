"use client";

import { getMetricType } from "@/config/metrics";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { DeltaBadge } from "./DeltaBadge";
import type { SummaryMetric } from "@/lib/dashboard/types";

interface SummaryStripProps {
  /** Summary metrics keyed by metric type */
  summary: Record<string, SummaryMetric>;
  /** Which metrics to display (in order). If not provided, shows all. */
  metrics?: string[];
  /** Whether the strip is loading */
  isLoading?: boolean;
}

/**
 * SummaryStrip — horizontal row of key metrics with DeltaBadge for each.
 *
 * Displays metric value, unit, and a polarity-aware DeltaBadge showing
 * deviation from 30-day average.
 *
 * See: wireframes W1-W2, W6 in /docs/design/wireframes.md
 */
export function SummaryStrip({
  summary,
  metrics,
  isLoading = false,
}: SummaryStripProps) {
  if (isLoading) {
    return (
      <div
        className="flex gap-4 overflow-x-auto py-2"
        data-testid="summary-strip-loading"
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-28 shrink-0 rounded-lg" />
        ))}
      </div>
    );
  }

  const displayMetrics = metrics ?? Object.keys(summary);

  if (displayMetrics.length === 0) {
    return null;
  }

  return (
    <div
      className="border-border flex gap-1 overflow-x-auto rounded-xl border p-2"
      data-testid="summary-strip"
    >
      {displayMetrics.map((metricType, i) => {
        const metric = summary[metricType];
        if (!metric) return null;

        const config = getMetricType(metricType);
        const label = config?.label ?? metricType.replace(/_/g, " ");
        const unit = config?.unit ?? "";

        return (
          <div
            key={metricType}
            className={cn(
              "flex min-w-[80px] flex-1 flex-col items-center px-2 py-2",
              i > 0 && "border-border border-l",
            )}
            data-testid="summary-metric"
          >
            <span className="text-muted-foreground mb-1 text-[10px] font-medium">
              {label}
            </span>
            <span className="text-lg leading-tight font-semibold">
              {formatValue(metric.value)}{" "}
              <span className="text-muted-foreground text-xs font-normal">
                {unit}
              </span>
            </span>
            <DeltaBadge
              delta={metric.delta}
              direction={metric.direction}
              metricLabel={label}
            />
          </div>
        );
      })}
    </div>
  );
}

function formatValue(v: number): string {
  return v % 1 === 0 ? v.toString() : v.toFixed(1);
}
