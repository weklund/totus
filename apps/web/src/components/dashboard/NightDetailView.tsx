"use client";

import { useMemo } from "react";
import { useNightView } from "@/hooks/useNightView";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorCard } from "./ErrorCard";
import { InsightCard } from "./InsightCard";
import { MetricStripContainer } from "./MetricStripContainer";
import { MetricStrip } from "./MetricStrip";
import type { MetricStripDataPoint } from "./MetricStrip";
import { AnnotationLayer } from "./AnnotationLayer";
import { SleepHypnogram } from "./SleepHypnogram";
import type { HypnogramSegment } from "./SleepHypnogram";
import { SummaryStrip } from "./SummaryStrip";
import type { BaselinePayload } from "@/lib/dashboard/types";
import type { ViewType } from "@/lib/dashboard/types";

/**
 * Default display order for summary metrics in the Night view.
 * Matches wireframe W1.
 */
const SUMMARY_METRIC_ORDER = [
  "sleep_score",
  "deep_sleep",
  "sleep_latency",
  "hrv",
  "rhr",
];

interface NightDetailViewProps {
  /** Selected date in YYYY-MM-DD format */
  date: string;
  /** Callback when date changes */
  onDateChange: (date: string) => void;
  /** Callback when view mode changes */
  onViewModeChange: (mode: ViewType) => void;
}

/**
 * NightDetailView — the Night Detail View page (W1).
 *
 * Composes shared components to render the full night view:
 * - InsightCard (conditional, when insights exist)
 * - MetricStripContainer with shared 8 PM – 8 AM time axis
 *   - AnnotationLayer (vertical markers)
 *   - MetricStrip panels for each intraday series (glucose, heart_rate, etc.)
 *   - SleepHypnogram
 * - SummaryStrip at bottom with polarity-aware delta badges
 *
 * Uses useNightView hook to fetch data. Handles loading, error, and empty states.
 *
 * See: wireframes W1 and scenario S1 (Late Meal Disrupts Sleep)
 */
export function NightDetailView({
  date,
  onDateChange: _onDateChange,
  onViewModeChange: _onViewModeChange,
}: NightDetailViewProps) {
  const { data, isLoading, isError, error, refetch } = useNightView(date);
  const nightData = data?.data;

  // Transform series data into MetricStripDataPoint arrays
  const metricStrips = useMemo(() => {
    if (!nightData?.series) return [];
    return Object.entries(nightData.series).map(([metricType, series]) => {
      const points: MetricStripDataPoint[] = series.timestamps.map((ts, i) => ({
        timestamp: ts,
        value: series.values[i],
      }));
      return { metricType, data: points };
    });
  }, [nightData?.series]);

  // Convert API baseline format to BaselinePayload for MetricStrip
  const baselineMap = useMemo(() => {
    if (!nightData?.baselines) return {};
    const map: Record<string, BaselinePayload> = {};
    for (const [key, b] of Object.entries(nightData.baselines)) {
      map[key] = {
        avg_30d: b.avg,
        stddev_30d: b.stddev,
        upper: b.upper,
        lower: b.lower,
        sample_count: 30, // Approximate — API doesn't return sample_count
      };
    }
    return map;
  }, [nightData?.baselines]);

  // Transform hypnogram data
  const hypnogramSegments = useMemo<HypnogramSegment[]>(() => {
    if (!nightData?.hypnogram?.stages) return [];
    return nightData.hypnogram.stages.map((s) => ({
      stage: s.stage,
      start: s.start,
      end: s.end,
    }));
  }, [nightData?.hypnogram]);

  // Determine which summary metrics to display (in order)
  const summaryMetricsOrder = useMemo(() => {
    if (!nightData?.summary) return [];
    const available = Object.keys(nightData.summary);
    // Show metrics in the preferred order, then any remaining
    const ordered = SUMMARY_METRIC_ORDER.filter((m) => available.includes(m));
    const remaining = available.filter(
      (m) => !SUMMARY_METRIC_ORDER.includes(m),
    );
    return [...ordered, ...remaining];
  }, [nightData?.summary]);

  // Check if the view has meaningful data
  const hasData = useMemo(() => {
    if (!nightData) return false;
    const hasSeries = Object.keys(nightData.series).length > 0;
    const hasHypnogram = nightData.hypnogram !== null;
    const hasSummary = Object.keys(nightData.summary).length > 0;
    return hasSeries || hasHypnogram || hasSummary;
  }, [nightData]);

  // ─── Loading State ──────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="night-view-loading">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    );
  }

  // ─── Error State ────────────────────────────────────────────
  if (isError) {
    return (
      <ErrorCard
        title="Failed to load night data"
        message={
          error instanceof Error
            ? error.message
            : "An unexpected error occurred"
        }
        onRetry={() => refetch()}
      />
    );
  }

  // ─── Empty State ────────────────────────────────────────────
  if (!hasData) {
    return (
      <div
        className="text-muted-foreground flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-16"
        data-testid="night-view-empty"
      >
        <span className="text-3xl" aria-hidden="true">
          🌙
        </span>
        <p className="text-sm font-medium">No data available for this night</p>
        <p className="max-w-sm text-center text-xs">
          There is no sleep or intraday data recorded for this date. Try
          selecting a different date.
        </p>
      </div>
    );
  }

  // ─── Data State ─────────────────────────────────────────────
  const timeRange = nightData!.time_range;

  return (
    <div className="space-y-4" data-testid="night-detail-view">
      {/* Insight cards (conditional — only when insights exist) */}
      {nightData!.insights.length > 0 && (
        <div className="space-y-3">
          {nightData!.insights.map((insight) => (
            <InsightCard key={insight.type} insight={insight} date={date} />
          ))}
        </div>
      )}

      {/* Metric strips with shared time axis + annotation layer */}
      <MetricStripContainer
        start={timeRange.start}
        end={timeRange.end}
        axisMode="time"
      >
        {/* Annotation markers spanning all panels */}
        {nightData!.annotations.length > 0 && (
          <AnnotationLayer
            annotations={nightData!.annotations}
            start={timeRange.start}
            end={timeRange.end}
          />
        )}

        {/* Intraday series metric strips */}
        {metricStrips.map(({ metricType, data: stripData }) => (
          <MetricStrip
            key={metricType}
            metricType={metricType}
            data={stripData}
            baseline={baselineMap[metricType] ?? null}
            summary={nightData!.summary[metricType] ?? null}
          />
        ))}

        {/* Sleep hypnogram */}
        <SleepHypnogram
          segments={hypnogramSegments}
          timeStart={timeRange.start}
          timeEnd={timeRange.end}
        />
      </MetricStripContainer>

      {/* Summary strip at the bottom */}
      {summaryMetricsOrder.length > 0 && (
        <SummaryStrip
          summary={nightData!.summary}
          metrics={summaryMetricsOrder}
        />
      )}
    </div>
  );
}
