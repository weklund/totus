"use client";

import { useState, useMemo, useEffect } from "react";
import { useViewContext } from "@/lib/view-context";
import { useHealthDataTypes } from "@/hooks/useHealthDataTypes";
import { MetricSelector } from "@/components/dashboard/MetricSelector";
import { DateRangeSelector } from "@/components/dashboard/DateRangeSelector";
import { ResolutionToggle } from "@/components/dashboard/ResolutionToggle";
import { ChartGrid } from "@/components/dashboard/ChartGrid";
import { Skeleton } from "@/components/ui/skeleton";

type Resolution = "daily" | "weekly" | "monthly";

/**
 * ViewerContent — viewer-specific dashboard content.
 *
 * Reuses dashboard chart components with viewer restrictions:
 * - MetricSelector shows only granted metrics
 * - DateRangeSelector locked to grant range (presets hidden)
 * - ActionBar hidden
 *
 * See: /docs/web-ui-lld.md Section 7.8
 */
export function ViewerContent() {
  const { permissions } = useViewContext();

  // Fetch available metric types (scoped by viewer cookie on server)
  const { data: typesData, isLoading: typesLoading } = useHealthDataTypes();
  const availableMetrics = useMemo(
    () => typesData?.data?.types ?? [],
    [typesData],
  );

  // Filter to only granted metrics
  const grantedMetrics = useMemo(() => {
    if (permissions.metrics === "all") return availableMetrics;
    const allowed = new Set(permissions.metrics as string[]);
    return availableMetrics.filter((m) => allowed.has(m.metric_type));
  }, [availableMetrics, permissions.metrics]);

  // State
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({
    start: permissions.dataStart ?? "",
    end: permissions.dataEnd ?? "",
  });
  const [resolution, setResolution] = useState<Resolution>("daily");
  const [metricsInitialized, setMetricsInitialized] = useState(false);

  // Initialize selected metrics from granted set
  useEffect(() => {
    if (metricsInitialized || grantedMetrics.length === 0) return;

    // Pre-select up to 3 granted metrics
    const metricIds = grantedMetrics.map((m) => m.metric_type);
    setSelectedMetrics(metricIds.slice(0, 3));

    // Set date range to grant boundaries
    if (permissions.dataStart && permissions.dataEnd) {
      setDateRange({
        start: permissions.dataStart,
        end: permissions.dataEnd,
      });
    }

    setMetricsInitialized(true);
  }, [grantedMetrics, metricsInitialized, permissions]);

  return (
    <div className="space-y-6" data-testid="viewer-content">
      {/* Toolbar */}
      <div className="space-y-4">
        {/* Metric selector — only granted metrics */}
        {typesLoading ? (
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-24 rounded-full" />
            ))}
          </div>
        ) : (
          <MetricSelector
            availableMetrics={grantedMetrics}
            selectedMetrics={selectedMetrics}
            onSelectionChange={setSelectedMetrics}
            maxSelection={3}
          />
        )}

        {/* Date range (locked to grant) + resolution */}
        <div className="flex flex-wrap items-center gap-4">
          <DateRangeSelector
            value={dateRange}
            onChange={setDateRange}
            minDate={permissions.dataStart ?? undefined}
            maxDate={permissions.dataEnd ?? undefined}
            showPresets={false}
          />
          <ResolutionToggle value={resolution} onChange={setResolution} />
        </div>
      </div>

      {/* No ActionBar for viewer */}

      {/* Charts */}
      <ChartGrid
        selectedMetrics={selectedMetrics}
        dateRange={dateRange}
        resolution={resolution}
      />
    </div>
  );
}
