"use client";

import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { useRecoveryView } from "@/hooks/useRecoveryView";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorCard } from "./ErrorCard";
import { InsightCard } from "./InsightCard";
import { MetricStripContainer } from "./MetricStripContainer";
import { MetricStrip } from "./MetricStrip";
import type { MetricStripDataPoint } from "./MetricStrip";
import { AnnotationLayer } from "./AnnotationLayer";
import { getMetricType } from "@/config/metrics";
import { cn } from "@/lib/cn";
import type {
  BaselinePayload,
  ViewType,
  SummaryMetric,
} from "@/lib/dashboard/types";

/**
 * Default display order for recovery metrics (matches W2 wireframe).
 */
const RECOVERY_METRIC_ORDER = [
  "readiness_score",
  "hrv",
  "rhr",
  "sleep_score",
  "body_temperature_deviation",
];

/**
 * Traffic-light status color mapping for the daily score table.
 */
const STATUS_COLORS: Record<
  string,
  { bg: string; text: string; indicator: string }
> = {
  critical: {
    bg: "bg-red-50 dark:bg-red-950/30",
    text: "text-red-700 dark:text-red-400",
    indicator: "🔴",
  },
  warning: {
    bg: "bg-amber-50 dark:bg-amber-950/30",
    text: "text-amber-700 dark:text-amber-400",
    indicator: "🟡",
  },
  normal: {
    bg: "bg-slate-50 dark:bg-slate-900/30",
    text: "text-slate-700 dark:text-slate-300",
    indicator: "",
  },
  good: {
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    text: "text-emerald-700 dark:text-emerald-400",
    indicator: "🟢",
  },
};

/** Allowed recovery range in days (3–7). */
const MIN_RANGE_DAYS = 3;
const MAX_RANGE_DAYS = 7;

interface RecoveryDetailViewProps {
  /** Start date in YYYY-MM-DD format */
  startDate: string;
  /** End date in YYYY-MM-DD format */
  endDate: string;
  /** Optional metrics filter */
  metrics?: string;
  /** Optional triggering event ID */
  eventId?: string;
  /** Current range in days (3–7) */
  rangeDays?: number;
  /** Callback when range days changes */
  onRangeDaysChange?: (days: number) => void;
  /** Callback when date changes */
  onDateChange: (date: string) => void;
  /** Callback when view mode changes */
  onViewModeChange: (mode: ViewType) => void;
}

/**
 * RecoveryDetailView — the Multi-Day Recovery View page (W2).
 *
 * Composes shared components to render the recovery view:
 * - InsightCard (conditional, recovery arc narrative)
 * - MetricStripContainer with shared day axis
 *   - AnnotationLayer (triggering event marker)
 *   - MetricStrip panels for each sparkline metric (with baseline bands)
 * - Daily Score Table (traffic-light colored values per day)
 *
 * Uses useRecoveryView hook to fetch data. Handles loading, error, and empty states.
 *
 * See: wireframe W2 and scenario S3 (Hard Workout Recovery Arc)
 */
export function RecoveryDetailView({
  startDate,
  endDate,
  metrics,
  eventId,
  rangeDays,
  onRangeDaysChange,
  onDateChange: _onDateChange,
  onViewModeChange: _onViewModeChange,
}: RecoveryDetailViewProps) {
  const { data, isLoading, isError, error, refetch } = useRecoveryView(
    startDate,
    endDate,
    metrics,
    eventId,
  );
  const recoveryData = data?.data;

  // Transform sparklines into MetricStripDataPoint arrays
  const metricStrips = useMemo(() => {
    if (!recoveryData?.sparklines) return [];

    // Get available sparkline metric types
    const available = Object.keys(recoveryData.sparklines);

    // Order by the preferred order, then remaining
    const ordered = RECOVERY_METRIC_ORDER.filter((m) => available.includes(m));
    const remaining = available.filter(
      (m) => !RECOVERY_METRIC_ORDER.includes(m),
    );
    const allMetrics = [...ordered, ...remaining];

    return allMetrics.map((metricType) => {
      const sparkline = recoveryData.sparklines[metricType];
      const points: MetricStripDataPoint[] = sparkline.dates.map((date, i) => ({
        timestamp: date,
        value: sparkline.values[i],
      }));
      return { metricType, data: points };
    });
  }, [recoveryData?.sparklines]);

  // Convert API baseline format to BaselinePayload for MetricStrip
  const baselineMap = useMemo(() => {
    if (!recoveryData?.baselines) return {};
    const map: Record<string, BaselinePayload> = {};
    for (const [key, b] of Object.entries(recoveryData.baselines)) {
      map[key] = {
        avg_30d: b.avg,
        stddev_30d: b.stddev,
        upper: b.upper,
        lower: b.lower,
        sample_count: 30, // Approximate — API doesn't return sample_count
      };
    }
    return map;
  }, [recoveryData?.baselines]);

  // Get the latest summary metric for each type (last day in range)
  const latestSummary = useMemo(() => {
    if (!recoveryData?.daily) return {};
    const dates = Object.keys(recoveryData.daily).sort();
    if (dates.length === 0) return {};
    const lastDate = dates[dates.length - 1];
    return recoveryData.daily[lastDate]?.metrics ?? {};
  }, [recoveryData?.daily]);

  // Determine sorted dates for the daily score table
  const sortedDates = useMemo(() => {
    if (!recoveryData?.daily) return [];
    return Object.keys(recoveryData.daily).sort();
  }, [recoveryData?.daily]);

  // Determine which metrics appear in the daily table
  const tableMetrics = useMemo(() => {
    if (sortedDates.length === 0 || !recoveryData?.daily) return [];
    // Collect all metric types across all days
    const allMetrics = new Set<string>();
    for (const dateKey of sortedDates) {
      const entry = recoveryData.daily[dateKey];
      if (entry?.metrics) {
        for (const metric of Object.keys(entry.metrics)) {
          allMetrics.add(metric);
        }
      }
    }
    // Sort by preferred order
    const available = Array.from(allMetrics);
    const ordered = RECOVERY_METRIC_ORDER.filter((m) => available.includes(m));
    const remaining = available.filter(
      (m) => !RECOVERY_METRIC_ORDER.includes(m),
    );
    return [...ordered, ...remaining];
  }, [sortedDates, recoveryData?.daily]);

  // Check if the view has meaningful data
  // Daily entries might exist (one per day) but have empty metrics — treat as no data
  const hasData = useMemo(() => {
    if (!recoveryData) return false;
    const hasSparklines = Object.keys(recoveryData.sparklines).length > 0;
    const hasDailyMetrics = Object.values(recoveryData.daily).some(
      (entry) => Object.keys(entry.metrics).length > 0,
    );
    return hasSparklines || hasDailyMetrics;
  }, [recoveryData]);

  // Build the time range for the MetricStripContainer
  // Use ISO date strings for the start/end of the date range
  const timeRange = useMemo(() => {
    if (!recoveryData?.date_range) return null;
    return {
      start: `${recoveryData.date_range.start}T00:00:00Z`,
      end: `${recoveryData.date_range.end}T23:59:59Z`,
    };
  }, [recoveryData?.date_range]);

  // Build the reference date for insight dismiss (use start date)
  const insightDate = recoveryData?.date_range?.start ?? startDate;

  // ─── Loading State ──────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="recovery-view-loading">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  // ─── Error State ────────────────────────────────────────────
  if (isError) {
    return (
      <ErrorCard
        title="Failed to load recovery data"
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
        data-testid="recovery-view-empty"
      >
        <span className="text-3xl" aria-hidden="true">
          🔄
        </span>
        <p className="text-sm font-medium">No recovery data available</p>
        <p className="max-w-sm text-center text-xs">
          There is no health data for this date range. Try selecting a different
          period or a shorter range.
        </p>
      </div>
    );
  }

  // ─── Data State ─────────────────────────────────────────────
  return (
    <div className="space-y-4" data-testid="recovery-detail-view">
      {/* Range selector (3–7 days) */}
      {onRangeDaysChange && rangeDays != null && (
        <RecoveryRangeSelector value={rangeDays} onChange={onRangeDaysChange} />
      )}

      {/* Insight cards (conditional — only when insights exist) */}
      {recoveryData!.insights.length > 0 && (
        <div className="space-y-3">
          {recoveryData!.insights.map((insight) => (
            <InsightCard
              key={insight.type}
              insight={insight}
              date={insightDate}
            />
          ))}
        </div>
      )}

      {/* Metric sparklines with shared day axis + annotation layer */}
      {timeRange && metricStrips.length > 0 && (
        <MetricStripContainer
          start={timeRange.start}
          end={timeRange.end}
          axisMode="date"
        >
          {/* Annotation markers (triggering event + other annotations) */}
          {recoveryData!.annotations.length > 0 && (
            <AnnotationLayer
              annotations={recoveryData!.annotations}
              start={timeRange.start}
              end={timeRange.end}
            />
          )}

          {/* Sparkline metric strips with baseline bands */}
          {metricStrips.map(({ metricType, data: stripData }) => (
            <MetricStrip
              key={metricType}
              metricType={metricType}
              data={stripData}
              baseline={baselineMap[metricType] ?? null}
              summary={latestSummary[metricType] ?? null}
            />
          ))}
        </MetricStripContainer>
      )}

      {/* Daily Score Table — traffic-light colored values per day */}
      {sortedDates.length > 0 && tableMetrics.length > 0 && (
        <DailyScoreTable
          dates={sortedDates}
          metrics={tableMetrics}
          daily={recoveryData!.daily}
        />
      )}
    </div>
  );
}

// ─── RecoveryRangeSelector Sub-Component ───────────────────────

interface RecoveryRangeSelectorProps {
  /** Current range in days */
  value: number;
  /** Callback when range changes */
  onChange: (days: number) => void;
}

/**
 * RecoveryRangeSelector — +/- buttons for selecting the recovery window
 * between MIN_RANGE_DAYS and MAX_RANGE_DAYS.
 */
function RecoveryRangeSelector({
  value,
  onChange,
}: RecoveryRangeSelectorProps) {
  return (
    <div
      className="flex items-center gap-2"
      data-testid="recovery-range-selector"
    >
      <span className="text-muted-foreground text-xs font-medium">Range:</span>
      <button
        type="button"
        disabled={value <= MIN_RANGE_DAYS}
        onClick={() => onChange(Math.max(MIN_RANGE_DAYS, value - 1))}
        className="bg-muted text-muted-foreground hover:text-foreground inline-flex size-7 items-center justify-center rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50"
        aria-label="Decrease range"
        data-testid="recovery-range-minus"
      >
        −
      </button>
      <span
        className="min-w-[3.5rem] text-center text-sm font-semibold"
        data-testid="recovery-range-value"
      >
        {value} days
      </span>
      <button
        type="button"
        disabled={value >= MAX_RANGE_DAYS}
        onClick={() => onChange(Math.min(MAX_RANGE_DAYS, value + 1))}
        className="bg-muted text-muted-foreground hover:text-foreground inline-flex size-7 items-center justify-center rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50"
        aria-label="Increase range"
        data-testid="recovery-range-plus"
      >
        +
      </button>
    </div>
  );
}

// ─── DailyScoreTable Sub-Component ─────────────────────────────

interface DailyScoreTableProps {
  dates: string[];
  metrics: string[];
  daily: Record<string, { metrics: Record<string, SummaryMetric> }>;
}

/**
 * DailyScoreTable — renders daily scores per metric with traffic-light colors.
 *
 * Rows = metrics, Columns = dates. Each cell is color-coded:
 * - Red (🔴) for critical status
 * - Yellow (🟡) for warning status
 * - Green (🟢) for good status
 * - Neutral for normal status
 *
 * See: wireframe W2, daily scores section
 */
function DailyScoreTable({ dates, metrics, daily }: DailyScoreTableProps) {
  return (
    <div
      className="border-border overflow-x-auto rounded-xl border"
      data-testid="daily-score-table"
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="text-muted-foreground px-3 py-2 text-left text-xs font-medium">
              Metric
            </th>
            {dates.map((date) => {
              let label: string;
              try {
                label = format(parseISO(date), "EEE d");
              } catch {
                label = date;
              }
              return (
                <th
                  key={date}
                  className="text-muted-foreground px-3 py-2 text-center text-xs font-medium"
                >
                  {label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {metrics.map((metricType, rowIndex) => {
            const config = getMetricType(metricType);
            const label = config?.label ?? metricType.replace(/_/g, " ");

            return (
              <tr
                key={metricType}
                className={cn(
                  rowIndex < metrics.length - 1 && "border-border border-b",
                )}
              >
                <td className="text-muted-foreground px-3 py-2 text-xs font-medium whitespace-nowrap">
                  {label}
                </td>
                {dates.map((date) => {
                  const dayEntry = daily[date];
                  const metric = dayEntry?.metrics?.[metricType];

                  if (!metric) {
                    return (
                      <td
                        key={date}
                        className="px-3 py-2 text-center"
                        data-testid="score-cell"
                      >
                        <span className="text-muted-foreground text-xs">—</span>
                      </td>
                    );
                  }

                  const statusStyle =
                    STATUS_COLORS[metric.status] ?? STATUS_COLORS.normal;

                  return (
                    <td
                      key={date}
                      className={cn("px-3 py-2 text-center", statusStyle.bg)}
                      data-testid="score-cell"
                      data-status={metric.status}
                    >
                      <span
                        className={cn(
                          "text-sm font-semibold",
                          statusStyle.text,
                        )}
                      >
                        {statusStyle.indicator && (
                          <span className="mr-0.5" aria-hidden="true">
                            {statusStyle.indicator}
                          </span>
                        )}
                        {formatValue(metric.value)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────

function formatValue(v: number): string {
  return v % 1 === 0 ? v.toString() : v.toFixed(1);
}
