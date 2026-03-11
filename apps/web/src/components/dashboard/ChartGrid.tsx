"use client";

import { useMemo } from "react";
import { useViewContext } from "@/lib/view-context";
import { useHealthData } from "@/hooks/useHealthData";
import { useViewerData } from "@/hooks/useViewerData";
import { useSeriesData } from "@/hooks/useSeriesData";
import { usePeriodsData } from "@/hooks/usePeriodsData";
import { getMetricType } from "@/config/metrics";
import { MetricChart } from "./MetricChart";
import { IntradayChart } from "./IntradayChart";
import { PeriodTimeline } from "./PeriodTimeline";
import { SourceBadge } from "./SourceBadge";
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
 * ChartGrid — responsive grid of charts for daily, series, and period data.
 *
 * Partitions selected metrics by their data type:
 * - daily → MetricChart (existing line charts)
 * - series → IntradayChart (high-frequency area chart)
 * - period → PeriodTimeline (colored bands / event cards)
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

  // Partition selected metrics by data type
  const { dailyMetrics, seriesMetrics, periodMetrics } = useMemo(() => {
    const daily: string[] = [];
    const series: string[] = [];
    const period: string[] = [];

    for (const metricId of selectedMetrics) {
      const config = getMetricType(metricId);
      if (!config) {
        daily.push(metricId); // Unknown metrics default to daily
        continue;
      }
      switch (config.dataType) {
        case "series":
          series.push(metricId);
          break;
        case "period":
          period.push(metricId);
          break;
        default:
          daily.push(metricId);
      }
    }

    return {
      dailyMetrics: daily,
      seriesMetrics: series,
      periodMetrics: period,
    };
  }, [selectedMetrics]);

  // ─── Daily data hook ──────────────────────────────────────
  const ownerQuery = useHealthData({
    metrics: role === "owner" ? dailyMetrics : [],
    start: dateRange.start,
    end: dateRange.end,
    resolution,
  });

  const viewerQuery = useViewerData({
    metrics: role === "viewer" ? dailyMetrics : [],
    start: dateRange.start,
    end: dateRange.end,
    resolution,
  });

  const query = role === "owner" ? ownerQuery : viewerQuery;
  const { data, isLoading, error, refetch } = query;

  // ─── Empty selection state ────────────────────────────────
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

  // ─── Error state (daily query) ────────────────────────────
  if (error && dailyMetrics.length > 0) {
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

  // ─── Loading state ────────────────────────────────────────
  if (isLoading && dailyMetrics.length > 0) {
    return (
      <div
        className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
        data-testid="chart-grid-loading"
      >
        {dailyMetrics.map((m) => (
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

  // Check if daily metrics have any data
  const hasAnyDailyData = dailyMetrics.some(
    (m) => metricsData[m]?.points && metricsData[m].points.length > 0,
  );

  const hasDailyMetrics = dailyMetrics.length > 0;
  const hasSeriesMetrics = seriesMetrics.length > 0;
  const hasPeriodMetrics = periodMetrics.length > 0;

  // If only daily metrics and no data at all
  if (
    hasDailyMetrics &&
    !hasSeriesMetrics &&
    !hasPeriodMetrics &&
    !hasAnyDailyData
  ) {
    return (
      <div
        className="text-muted-foreground flex items-center justify-center rounded-lg border border-dashed py-16"
        data-testid="chart-grid-no-data"
      >
        <p className="text-sm">No data available for the selected period</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="chart-grid">
      {/* ─── Daily Charts ────────────────────────────────────── */}
      {hasDailyMetrics && hasAnyDailyData && (
        <>
          {dailyMetrics.length > 1 ? (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">
                    {dailyMetrics
                      .map((m) => getMetricType(m)?.label ?? m)
                      .join(" · ")}
                  </CardTitle>
                  <DailySourceIndicator
                    metricsData={metricsData}
                    metrics={dailyMetrics}
                  />
                </div>
              </CardHeader>
              <CardContent>
                <MetricChart
                  data={metricsData}
                  metrics={dailyMetrics}
                  height={400}
                />
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              {dailyMetrics.map((metricId) => {
                const config = getMetricType(metricId);
                const metricData = metricsData[metricId];
                const isEmpty =
                  !metricData?.points || metricData.points.length === 0;

                return (
                  <Card key={metricId}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-medium">
                          {config?.label ?? metricId}
                        </CardTitle>
                        {!isEmpty && metricData?.points[0]?.source && (
                          <SourceBadge
                            provider={metricData.points[0].source}
                            showName
                            size="sm"
                          />
                        )}
                      </div>
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
          )}
        </>
      )}

      {/* ─── Series (Intraday) Charts ────────────────────────── */}
      {hasSeriesMetrics && (
        <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
          {seriesMetrics.map((metricId) => (
            <Card key={metricId}>
              <CardContent className="pt-4">
                <SeriesChartWrapper
                  metricType={metricId}
                  from={dateRange.start}
                  to={dateRange.end}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ─── Period Timelines ────────────────────────────────── */}
      {hasPeriodMetrics && (
        <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
          {periodMetrics.map((metricId) => (
            <Card key={metricId}>
              <CardContent className="pt-4">
                <PeriodTimelineWrapper
                  eventType={metricId}
                  from={dateRange.start}
                  to={dateRange.end}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Wrapper Components for Series & Period Hooks ───────────

/**
 * SeriesChartWrapper — fetches series data and renders IntradayChart.
 * Separated to allow each series metric to have its own loading state.
 */
function SeriesChartWrapper({
  metricType,
  from,
  to,
}: {
  metricType: string;
  from: string;
  to: string;
}) {
  const { data, isLoading } = useSeriesData({
    metric_type: metricType,
    from,
    to,
  });

  return (
    <IntradayChart
      metricType={metricType}
      source={data?.data?.source ?? ""}
      readings={data?.data?.readings ?? []}
      isLoading={isLoading}
    />
  );
}

/**
 * PeriodTimelineWrapper — fetches period data and renders PeriodTimeline.
 * Separated to allow each period metric to have its own loading state.
 */
function PeriodTimelineWrapper({
  eventType,
  from,
  to,
}: {
  eventType: string;
  from: string;
  to: string;
}) {
  const { data, isLoading } = usePeriodsData({
    event_type: eventType,
    from,
    to,
  });

  return (
    <PeriodTimeline
      eventType={eventType}
      periods={data?.data?.periods ?? []}
      isLoading={isLoading}
    />
  );
}

// ─── Source Indicator for Daily Charts ──────────────────────

/**
 * DailySourceIndicator — shows source badges for the sources present
 * in the displayed daily metrics data.
 */
function DailySourceIndicator({
  metricsData,
  metrics,
}: {
  metricsData: Record<
    string,
    {
      unit: string;
      points: Array<{ date: string; value: number; source: string }>;
    }
  >;
  metrics: string[];
}) {
  const sources = useMemo(() => {
    const sourceSet = new Set<string>();
    for (const metricId of metrics) {
      const metricData = metricsData[metricId];
      if (metricData?.points) {
        for (const point of metricData.points) {
          if (point.source) sourceSet.add(point.source);
        }
      }
    }
    return Array.from(sourceSet);
  }, [metricsData, metrics]);

  if (sources.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      {sources.map((source) => (
        <SourceBadge key={source} provider={source} showName size="sm" />
      ))}
    </div>
  );
}
