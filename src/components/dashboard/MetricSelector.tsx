"use client";

import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { getMetricColor } from "@/lib/chart-utils";
import type { HealthDataType } from "@/hooks/useHealthDataTypes";
import type { MetricCategory } from "@/config/metrics";

const CATEGORY_ORDER: MetricCategory[] = [
  "Sleep",
  "Cardio",
  "Activity",
  "Body",
];

interface MetricSelectorProps {
  /** All available metric types (from useHealthDataTypes) */
  availableMetrics: HealthDataType[];
  /** Currently selected metric type IDs */
  selectedMetrics: string[];
  /** Callback when selection changes */
  onSelectionChange: (metrics: string[]) => void;
  /** Maximum number of selectable metrics (default: 3 for overlay) */
  maxSelection?: number;
  /** Whether the selector is read-only (viewer mode) */
  readOnly?: boolean;
}

export function MetricSelector({
  availableMetrics,
  selectedMetrics,
  onSelectionChange,
  maxSelection = 3,
  readOnly = false,
}: MetricSelectorProps) {
  // Group metrics by category, deduplicating by metric_type
  const metricsByCategory = useMemo(() => {
    const seen = new Set<string>();
    const grouped = new Map<string, HealthDataType[]>();

    for (const metric of availableMetrics) {
      if (seen.has(metric.metric_type)) continue;
      seen.add(metric.metric_type);

      const category = metric.category || "Other";
      const list = grouped.get(category) || [];
      list.push(metric);
      grouped.set(category, list);
    }

    // Return in defined category order
    return CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((cat) => ({
      category: cat,
      metrics: grouped.get(cat)!,
    }));
  }, [availableMetrics]);

  const isMaxReached = selectedMetrics.length >= maxSelection;

  function toggleMetric(metricType: string) {
    if (readOnly) return;

    if (selectedMetrics.includes(metricType)) {
      onSelectionChange(selectedMetrics.filter((m) => m !== metricType));
    } else if (!isMaxReached) {
      onSelectionChange([...selectedMetrics, metricType]);
    }
  }

  return (
    <div className="space-y-3" data-testid="metric-selector">
      {metricsByCategory.map(({ category, metrics }) => (
        <div key={category}>
          <h4 className="text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase">
            {category}
          </h4>
          <div className="flex flex-wrap gap-2">
            {metrics.map((metric) => {
              const isSelected = selectedMetrics.includes(metric.metric_type);
              const isDisabled = !isSelected && isMaxReached;
              const color = getMetricColor(metric.metric_type);

              return (
                <button
                  key={metric.metric_type}
                  type="button"
                  onClick={() => toggleMetric(metric.metric_type)}
                  disabled={readOnly ? false : isDisabled}
                  title={
                    isDisabled
                      ? `Maximum ${maxSelection} metrics selected`
                      : undefined
                  }
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    isSelected
                      ? "border-transparent text-white"
                      : "border-border text-foreground hover:bg-accent",
                    isDisabled && "cursor-not-allowed opacity-40",
                    readOnly && "cursor-default",
                  )}
                  style={
                    isSelected ? { backgroundColor: color.line } : undefined
                  }
                  data-testid={`metric-chip-${metric.metric_type}`}
                >
                  {!isSelected && (
                    <span
                      className="inline-block size-2 rounded-full"
                      style={{ backgroundColor: color.line }}
                    />
                  )}
                  {metric.label}
                  <span
                    className={cn(
                      "text-[10px]",
                      isSelected ? "text-white/70" : "text-muted-foreground",
                    )}
                  >
                    {metric.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
