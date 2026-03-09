"use client";

import { useViewContext } from "@/lib/view-context";
import { useHealthData } from "@/hooks/useHealthData";
import { useViewerData } from "@/hooks/useViewerData";
import { getMetricType } from "@/config/metrics";
import { MetricChart } from "./MetricChart";
import { ErrorCard } from "./ErrorCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ChartGridProps {
  /** Currently selected metrics */
  selectedMetrics: string[];
  /** Date range for data fetching */
  dateRange: { start: string; end: string };
  /** Resolution */
  resolution: "daily" | "weekly" | "monthly";
}

/**
 * ChartGrid — responsive grid of MetricChart components.
 *
 * Shows skeleton loaders while data loads, error card with retry on failure,
 * and empty state when no data.
 *
 * Uses ViewContext to choose between owner and viewer data hooks.
 */
export function ChartGrid({
  selectedMetrics,
  dateRange,
  resolution,
}: ChartGridProps) {
  const { role } = useViewContext();

  // Select the appropriate hook based on role
  // Both hooks return the same shape — the switch is transparent to the charts
  const ownerQuery = useHealthData({
    metrics: role === "owner" ? selectedMetrics : [],
    start: dateRange.start,
    end: dateRange.end,
    resolution,
  });

  const viewerQuery = useViewerData({
    metrics: role === "viewer" ? selectedMetrics : [],
    start: dateRange.start,
    end: dateRange.end,
    resolution,
  });

  const query = role === "owner" ? ownerQuery : viewerQuery;
  const { data, isLoading, error, refetch } = query;

  if (selectedMetrics.length === 0) {
    return (
      <div
        className="text-muted-foreground flex items-center justify-center rounded-lg border border-dashed py-16"
        data-testid="chart-grid-empty-selection"
      >
        <p className="text-sm">Select metrics above to view charts</p>
      </div>
    );
  }

  if (error) {
    return (
      <ErrorCard
        title="Failed to load data"
        message={
          error.message || "An error occurred while loading health data."
        }
        onRetry={() => refetch()}
      />
    );
  }

  if (isLoading) {
    return (
      <div
        className="grid gap-4 md:grid-cols-2"
        data-testid="chart-grid-loading"
      >
        {selectedMetrics.map((m) => (
          <Card key={m}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[300px] w-full rounded-lg" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const metricsData = data?.data?.metrics ?? {};

  // If all selected metrics have no data
  const hasAnyData = selectedMetrics.some(
    (m) => metricsData[m]?.points && metricsData[m].points.length > 0,
  );

  if (!hasAnyData) {
    return (
      <div
        className="text-muted-foreground flex items-center justify-center rounded-lg border border-dashed py-16"
        data-testid="chart-grid-no-data"
      >
        <p className="text-sm">No data available for the selected period</p>
      </div>
    );
  }

  // If 2-3 metrics, show as overlay in a single chart
  if (selectedMetrics.length > 1) {
    return (
      <div data-testid="chart-grid">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {selectedMetrics
                .map((m) => getMetricType(m)?.label ?? m)
                .join(" · ")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MetricChart
              data={metricsData}
              metrics={selectedMetrics}
              height={400}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Single metric: show individual chart
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="chart-grid">
      {selectedMetrics.map((metricId) => {
        const config = getMetricType(metricId);
        const metricData = metricsData[metricId];
        const isEmpty = !metricData?.points || metricData.points.length === 0;

        return (
          <Card key={metricId}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                {config?.label ?? metricId}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isEmpty ? (
                <div
                  className="text-muted-foreground flex items-center justify-center rounded-lg border border-dashed"
                  style={{ height: 300 }}
                >
                  <p className="text-sm">No data for this metric</p>
                </div>
              ) : (
                <MetricChart
                  data={metricsData}
                  metrics={[metricId]}
                  height={300}
                />
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
