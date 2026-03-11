"use client";

import { useMemo } from "react";
import { MetricSelector } from "@/components/dashboard/MetricSelector";
import { getMetricType } from "@/config/metrics";
import { cn } from "@/lib/cn";
import { getMetricColor } from "@/lib/chart-utils";
import type { HealthDataType } from "@/hooks/useHealthDataTypes";

interface ShareWizardStepMetricsProps {
  availableMetrics: HealthDataType[];
  selectedMetrics: string[];
  onSelectionChange: (metrics: string[]) => void;
  error?: string;
}

/** Period event type definitions for the share wizard. */
const PERIOD_EVENT_TYPES = [
  { id: "sleep_stage", label: "Sleep Stages", category: "sleep" },
  { id: "workout", label: "Workouts", category: "activity" },
  { id: "meal", label: "Meals", category: "nutrition" },
] as const;

export function ShareWizardStepMetrics({
  availableMetrics,
  selectedMetrics,
  onSelectionChange,
  error,
}: ShareWizardStepMetricsProps) {
  // Separate daily/series metrics from period event types
  const { scalarMetrics, periodEventTypes } = useMemo(() => {
    const scalar: HealthDataType[] = [];
    const periods: HealthDataType[] = [];

    for (const metric of availableMetrics) {
      const metricConfig = getMetricType(metric.metric_type);
      if (metricConfig?.dataType === "period") {
        periods.push(metric);
      } else {
        scalar.push(metric);
      }
    }

    // Also add period event types that aren't in available metrics
    // (they may not have data yet but should still be selectable for sharing)
    const availableIds = new Set(availableMetrics.map((m) => m.metric_type));
    for (const pet of PERIOD_EVENT_TYPES) {
      if (!availableIds.has(pet.id)) {
        const metricConfig = getMetricType(pet.id);
        if (metricConfig) {
          periods.push({
            metric_type: pet.id,
            label: pet.label,
            unit: "—",
            category: pet.category,
            source: "",
            date_range: { start: "", end: "" },
            count: 0,
          });
        }
      }
    }

    return { scalarMetrics: scalar, periodEventTypes: periods };
  }, [availableMetrics]);

  function toggleMetric(metricType: string) {
    if (selectedMetrics.includes(metricType)) {
      onSelectionChange(selectedMetrics.filter((m) => m !== metricType));
    } else {
      onSelectionChange([...selectedMetrics, metricType]);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">Select Metrics</h3>
        <p className="text-muted-foreground text-sm">
          Choose which health metrics and events to include in this share. Only
          metrics you have data for are shown.
        </p>
      </div>

      {/* Scalar metrics (daily + series) */}
      <MetricSelector
        availableMetrics={scalarMetrics}
        selectedMetrics={selectedMetrics}
        onSelectionChange={onSelectionChange}
        maxSelection={50}
      />

      {/* Period event types */}
      {periodEventTypes.length > 0 && (
        <div data-testid="period-event-types">
          <h4 className="text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase">
            Event Types
          </h4>
          <div className="flex flex-wrap gap-2">
            {periodEventTypes.map((metric) => {
              const isSelected = selectedMetrics.includes(metric.metric_type);
              const color = getMetricColor(metric.metric_type);

              return (
                <button
                  key={metric.metric_type}
                  type="button"
                  onClick={() => toggleMetric(metric.metric_type)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    isSelected
                      ? "border-transparent text-white"
                      : "border-border text-foreground hover:bg-accent",
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
                  {metric.count > 0 && (
                    <span
                      className={cn(
                        "text-[10px]",
                        isSelected ? "text-white/70" : "text-muted-foreground",
                      )}
                    >
                      {metric.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
