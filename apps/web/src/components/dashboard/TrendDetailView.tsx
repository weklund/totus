"use client";

import { useMemo, useState, useCallback } from "react";
import { format, subDays, parseISO } from "date-fns";
import {
  ComposedChart,
  Area,
  Line,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { useTrendView } from "@/hooks/useTrendView";
import type { TrendMetricData } from "@/hooks/useTrendView";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorCard } from "./ErrorCard";
import { InsightCard } from "./InsightCard";
import { BaselineBand } from "./BaselineBand";
import { ResolutionToggle } from "./ResolutionToggle";
import { getMetricColor } from "@/lib/chart-utils";
import { getMetricType } from "@/config/metrics";
import { cn } from "@/lib/cn";
import type { BaselinePayload, ViewType } from "@/lib/dashboard/types";

/**
 * Default metrics shown in the Trend view (matches W3 wireframe / S4 scenario).
 */
const DEFAULT_TREND_METRICS = ["rhr", "hrv", "sleep_score"];

/**
 * Range preset options — label, number of days, and smoothing default.
 */
const RANGE_PRESETS = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "1Y", days: 365 },
] as const;

/**
 * Map resolution toggle values to API smoothing param.
 */
const RESOLUTION_TO_SMOOTHING: Record<string, string | undefined> = {
  daily: "none",
  weekly: "7d",
  monthly: "30d",
};

interface TrendDetailViewProps {
  /** Anchor date (end of range) in YYYY-MM-DD format */
  date: string;
  /** Metrics to display (comma-separated) */
  metrics?: string;
  /** Active range preset in days (controlled from URL params) */
  activePreset?: number;
  /** Callback when range preset changes */
  onPresetChange?: (days: number) => void;
  /** Resolution toggle value (controlled from URL params) */
  resolution?: "daily" | "weekly" | "monthly";
  /** Callback when resolution/smoothing changes */
  onResolutionChange?: (r: "daily" | "weekly" | "monthly") => void;
  /** Callback when date changes */
  onDateChange: (date: string) => void;
  /** Callback when view mode changes */
  onViewModeChange: (mode: ViewType) => void;
}

/**
 * Convert an epoch-ms timestamp to YYYY-MM-DD string using local timezone.
 */
function epochToDateStr(ts: number): string {
  const d = new Date(ts);
  return format(d, "yyyy-MM-dd");
}

/**
 * TrendDetailView — the 30-Day Trend View page (W3).
 *
 * Composes:
 * - Range presets (7D / 30D / 90D / 1Y)
 * - Resolution toggle (Daily / 7-Day Avg / Monthly)
 * - InsightCards (conditional)
 * - CorrelationCard (when correlations exist)
 * - MetricStripContainer-like layout with metric panels showing:
 *   - Raw daily data as individual dots
 *   - Smoothed rolling average as a continuous line
 *   - Baseline bands (avg ± 1 SD)
 *   - Trend indicators (arrow + start/end values + percentage change)
 *
 * Uses useTrendView hook. Handles loading, error, and empty states.
 *
 * See: wireframe W3 and scenario S4 (Doctor Visit Preparation)
 */
export function TrendDetailView({
  date,
  metrics,
  activePreset: controlledPreset,
  onPresetChange: controlledOnPresetChange,
  resolution: controlledResolution,
  onResolutionChange: controlledOnResolutionChange,
  onDateChange,
  onViewModeChange,
}: TrendDetailViewProps) {
  // Fallback internal state when not controlled via URL params
  const [internalPreset, setInternalPreset] = useState<number>(30);
  const [internalResolution, setInternalResolution] = useState<
    "daily" | "weekly" | "monthly"
  >("weekly");

  // Use controlled values from URL when available, otherwise internal state
  const activePreset = controlledPreset ?? internalPreset;
  const resolution = controlledResolution ?? internalResolution;

  // Compute date range from anchor date and preset
  const dateRange = useMemo(() => {
    try {
      const endDate = parseISO(date);
      const startDate = subDays(endDate, activePreset - 1);
      return {
        start: format(startDate, "yyyy-MM-dd"),
        end: format(endDate, "yyyy-MM-dd"),
      };
    } catch {
      return { start: date, end: date };
    }
  }, [date, activePreset]);

  const metricsParam = metrics ?? DEFAULT_TREND_METRICS.join(",");
  const smoothing = RESOLUTION_TO_SMOOTHING[resolution];

  const { data, isLoading, isError, error, refetch } = useTrendView(
    dateRange.start,
    dateRange.end,
    metricsParam,
    smoothing,
  );
  const trendData = data?.data;

  // Determine if there is meaningful data
  const hasData = useMemo(() => {
    if (!trendData) return false;
    return Object.keys(trendData.metrics).length > 0;
  }, [trendData]);

  // Determine metric ordering (preserve DEFAULT_TREND_METRICS order, then extras)
  const orderedMetrics = useMemo(() => {
    if (!trendData?.metrics) return [];
    const available = Object.keys(trendData.metrics);
    const requested = metricsParam.split(",").map((m) => m.trim());
    const ordered = requested.filter((m) => available.includes(m));
    const extra = available.filter((m) => !ordered.includes(m));
    return [...ordered, ...extra];
  }, [trendData?.metrics, metricsParam]);

  // Reference date for insight dismiss — use the start of the range
  const insightDate = trendData?.date_range?.start ?? dateRange.start;

  const handlePresetChange = useCallback(
    (days: number) => {
      if (controlledOnPresetChange) {
        controlledOnPresetChange(days);
      } else {
        setInternalPreset(days);
      }
    },
    [controlledOnPresetChange],
  );

  const handleResolutionChange = useCallback(
    (r: "daily" | "weekly" | "monthly") => {
      if (controlledOnResolutionChange) {
        controlledOnResolutionChange(r);
      } else {
        setInternalResolution(r);
      }
    },
    [controlledOnResolutionChange],
  );

  /** Navigate to Night view for the clicked date */
  const handleDateClick = useCallback(
    (ts: number) => {
      const clickedDate = epochToDateStr(ts);
      onDateChange(clickedDate);
      onViewModeChange("night");
    },
    [onDateChange, onViewModeChange],
  );

  // ─── Loading State ──────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="trend-view-loading">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48 rounded-lg" />
          <Skeleton className="h-8 w-56 rounded-lg" />
        </div>
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }

  // ─── Error State ────────────────────────────────────────────
  if (isError) {
    return (
      <ErrorCard
        title="Failed to load trend data"
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
      <div className="space-y-4">
        <TrendToolbar
          activePreset={activePreset}
          onPresetChange={handlePresetChange}
          resolution={resolution}
          onResolutionChange={handleResolutionChange}
        />
        <div
          className="text-muted-foreground flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-16"
          data-testid="trend-view-empty"
        >
          <span className="text-3xl" aria-hidden="true">
            📈
          </span>
          <p className="text-sm font-medium">No trend data available</p>
          <p className="max-w-sm text-center text-xs">
            There is no health data for this date range. Try selecting a
            different period or a wider range.
          </p>
        </div>
      </div>
    );
  }

  // ─── Data State ─────────────────────────────────────────────
  return (
    <div className="space-y-4" data-testid="trend-detail-view">
      {/* Toolbar: range presets + resolution toggle */}
      <TrendToolbar
        activePreset={activePreset}
        onPresetChange={handlePresetChange}
        resolution={resolution}
        onResolutionChange={handleResolutionChange}
      />

      {/* Insight cards (conditional) */}
      {trendData!.insights.length > 0 && (
        <div className="space-y-3">
          {trendData!.insights.map((insight) => (
            <InsightCard
              key={insight.type}
              insight={insight}
              date={insightDate}
            />
          ))}
        </div>
      )}

      {/* Correlation card (when correlations exist) */}
      {trendData!.correlations.length > 0 && (
        <CorrelationCard
          correlations={trendData!.correlations}
          dateRange={trendData!.date_range}
        />
      )}

      {/* Metric panels with raw dots + smoothed line + baseline bands + trend indicators */}
      <div className="flex flex-col gap-4" data-testid="trend-metric-panels">
        {orderedMetrics.map((metricType) => {
          const metricData = trendData!.metrics[metricType];
          if (!metricData) return null;
          return (
            <TrendMetricPanel
              key={metricType}
              metricType={metricType}
              data={metricData}
              resolution={resolution}
              onDateClick={handleDateClick}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── TrendToolbar ──────────────────────────────────────────────

interface TrendToolbarProps {
  activePreset: number;
  onPresetChange: (days: number) => void;
  resolution: "daily" | "weekly" | "monthly";
  onResolutionChange: (r: "daily" | "weekly" | "monthly") => void;
}

function TrendToolbar({
  activePreset,
  onPresetChange,
  resolution,
  onResolutionChange,
}: TrendToolbarProps) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3"
      data-testid="trend-toolbar"
    >
      {/* Range presets */}
      <div
        className="bg-muted inline-flex items-center gap-0.5 rounded-lg p-0.5"
        role="tablist"
        aria-label="Date range presets"
        data-testid="range-presets"
      >
        {RANGE_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            role="tab"
            aria-selected={activePreset === preset.days}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              activePreset === preset.days
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onPresetChange(preset.days)}
            data-testid={`range-preset-${preset.label.toLowerCase()}`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Resolution toggle */}
      <ResolutionToggle value={resolution} onChange={onResolutionChange} />
    </div>
  );
}

// ─── TrendMetricPanel ──────────────────────────────────────────

interface TrendMetricPanelProps {
  metricType: string;
  data: TrendMetricData;
  resolution: "daily" | "weekly" | "monthly";
  /** Callback when a data point is clicked — receives epoch-ms timestamp */
  onDateClick?: (timestamp: number) => void;
}

/**
 * TrendMetricPanel — a single metric chart in the trend view showing:
 * - Raw daily data as individual dots
 * - Smoothed rolling average as a continuous line
 * - Baseline band (avg ± 1 SD) as shaded region
 * - Trend indicator header (arrow + start/end values + percentage change)
 */
function TrendMetricPanel({
  metricType,
  data: metricData,
  resolution,
  onDateClick,
}: TrendMetricPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const config = getMetricType(metricType);
  const color = getMetricColor(metricType);
  const label = config?.label ?? metricType.replace(/_/g, " ");
  const unit = config?.unit ?? "";

  const { trend, baseline, raw, smoothed } = metricData;

  // Build chart data: combine raw and smoothed values by date
  const chartData = useMemo(() => {
    const dateMap = new Map<
      string,
      { date: string; raw?: number; smoothed?: number }
    >();

    // Add raw data points
    raw.dates.forEach((d, i) => {
      dateMap.set(d, { date: d, raw: raw.values[i] });
    });

    // Add smoothed data points
    if (smoothed) {
      smoothed.dates.forEach((d, i) => {
        const existing = dateMap.get(d);
        if (existing) {
          existing.smoothed = smoothed.values[i];
        } else {
          dateMap.set(d, { date: d, smoothed: smoothed.values[i] });
        }
      });
    }

    // Sort by date and convert to epoch ms for Recharts.
    // Use "YYYY-MM-DDT00:00:00" to force local timezone interpretation,
    // avoiding the UTC-midnight pitfall of new Date("YYYY-MM-DD") which can
    // shift the visible day in negative-offset timezones (e.g. US time zones).
    return Array.from(dateMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        timestamp: new Date(d.date + "T00:00:00").getTime(),
        raw: d.raw,
        smoothed: d.smoothed,
      }));
  }, [raw, smoothed]);

  // Build BaselinePayload for the BaselineBand component
  const baselinePayload = useMemo<BaselinePayload | null>(() => {
    if (!baseline) return null;
    return {
      avg_30d: baseline.avg,
      stddev_30d: baseline.stddev,
      upper: baseline.upper,
      lower: baseline.lower,
      sample_count: baseline.sample_count ?? 30,
    };
  }, [baseline]);

  // Trend indicator arrow and color
  const trendArrow =
    trend.direction === "rising"
      ? "↑"
      : trend.direction === "falling"
        ? "↓"
        : "→";
  const trendColor =
    trend.direction === "rising"
      ? "text-[#E8845A]"
      : trend.direction === "falling"
        ? "text-[#E8845A]"
        : "text-muted-foreground";

  // Determine if the trend is positive or negative based on metric polarity
  // For now, just use the generic arrow direction
  const changePctFormatted = `${trend.change_pct >= 0 ? "+" : ""}${trend.change_pct.toFixed(1)}%`;
  const startFormatted = formatValue(trend.start_value);
  const endFormatted = formatValue(trend.end_value);

  const height = expanded ? 200 : 80;

  const tickFormatter = (ts: string | number): string => {
    try {
      const d = typeof ts === "number" ? new Date(ts) : parseISO(ts);
      return format(d, "MMM d");
    } catch {
      return String(ts);
    }
  };

  // Compute x domain
  const xDomain = useMemo<[number, number] | undefined>(() => {
    if (chartData.length === 0) return undefined;
    return [chartData[0].timestamp, chartData[chartData.length - 1].timestamp];
  }, [chartData]);

  if (chartData.length === 0) {
    return (
      <div
        className="text-muted-foreground flex items-center justify-center rounded-lg border border-dashed"
        style={{ height: 80 }}
        data-testid="trend-metric-panel-empty"
      >
        <p className="text-sm">No {label.toLowerCase()} data</p>
      </div>
    );
  }

  return (
    <div
      className="border-border rounded-xl border"
      data-testid="trend-metric-panel"
    >
      {/* Header with metric name, trend indicator, expand/collapse */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left"
        aria-expanded={expanded}
        aria-label={`${label} trend chart, click to ${expanded ? "collapse" : "expand"}`}
        data-testid="trend-metric-header"
      >
        <div className="flex items-center gap-2">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: color.line }}
            aria-hidden="true"
          />
          <span className="text-sm font-semibold">{label}</span>
        </div>

        <div className="flex items-center gap-3">
          {/* Trend indicator: start → end (change%) */}
          <span
            className="text-xs font-medium"
            data-testid="trend-indicator"
            aria-label={`Trend: ${startFormatted} to ${endFormatted} ${unit}, ${changePctFormatted}`}
          >
            <span className="text-muted-foreground">{startFormatted}</span>
            <span className={cn("mx-1", trendColor)} aria-hidden="true">
              {trendArrow}
            </span>
            <span className="font-semibold">
              {endFormatted} {unit}
            </span>
            <span className={cn("ml-1.5 text-[11px]", trendColor)}>
              ({changePctFormatted})
            </span>
          </span>

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
          <ComposedChart
            data={chartData}
            margin={{ top: 4, right: 12, bottom: 4, left: expanded ? 4 : -20 }}
            onClick={
              onDateClick
                ? (nextState) => {
                    // activeLabel contains the XAxis value (epoch ms) of the clicked point
                    const ts = nextState?.activeLabel;
                    if (typeof ts === "number") onDateClick(ts);
                  }
                : undefined
            }
            style={onDateClick ? { cursor: "pointer" } : undefined}
          >
            {expanded && (
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
            )}
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={xDomain}
              scale="time"
              tickFormatter={tickFormatter}
              tick={
                expanded
                  ? { fontSize: 10, fill: "var(--chart-axis-label)" }
                  : false
              }
              stroke="var(--chart-grid)"
              minTickGap={50}
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
                content={<TrendTooltip metricType={metricType} unit={unit} />}
              />
            )}

            {/* Baseline band */}
            {baselinePayload && (
              <BaselineBand
                baseline={baselinePayload}
                metricType={metricType}
              />
            )}

            {/* Baseline average reference line */}
            {baselinePayload && (
              <ReferenceLine
                y={baselinePayload.avg_30d}
                yAxisId="y-0"
                stroke={color.line}
                strokeDasharray="4 4"
                strokeOpacity={0.5}
              />
            )}

            {/* Smoothed rolling average line (primary visual) */}
            {resolution !== "daily" && (
              <Line
                yAxisId="y-0"
                type="monotone"
                dataKey="smoothed"
                stroke={color.line}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls
              />
            )}

            {/* Raw data dots */}
            <Scatter
              yAxisId="y-0"
              dataKey="raw"
              fill={color.line}
              fillOpacity={resolution === "daily" ? 0.8 : 0.3}
              r={resolution === "daily" ? 3 : 2}
              shape="circle"
            />

            {/* When daily resolution is selected, connect raw data with area */}
            {resolution === "daily" && (
              <Area
                yAxisId="y-0"
                type="monotone"
                dataKey="raw"
                stroke={color.line}
                fill={color.fill}
                strokeWidth={1.5}
                dot={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── CorrelationCard ───────────────────────────────────────────

interface CorrelationCardProps {
  correlations: Array<{
    pair: [string, string];
    coefficient: number;
    strength: string;
    direction: string;
    sample_count: number;
    sufficient_data: boolean;
  }>;
  dateRange: { start: string; end: string };
}

/**
 * CorrelationCard — shows Pearson correlations between metric pairs.
 *
 * Displays coefficient, strength label, and direction for each pair.
 * Includes a "Share ↗" button (UI placeholder for sharing flow).
 *
 * See: wireframe W3, correlation card section
 */
function CorrelationCard({ correlations, dateRange }: CorrelationCardProps) {
  const validCorrelations = correlations.filter((c) => c.sufficient_data);

  if (validCorrelations.length === 0) return null;

  return (
    <div
      className="bg-card rounded-xl border p-4"
      data-testid="correlation-card"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span aria-hidden="true">📊</span>
          <span className="text-sm font-semibold">Correlations</span>
          <span className="text-muted-foreground text-xs">
            {dateRange.start} — {dateRange.end}
          </span>
        </div>
        <button
          type="button"
          className="text-xs font-medium text-[#1E5B7B] hover:underline"
          data-testid="correlation-share-btn"
          aria-label="Share this view"
        >
          Share ↗
        </button>
      </div>

      <div className="space-y-2">
        {validCorrelations.map((corr) => {
          const metricAConfig = getMetricType(corr.pair[0]);
          const metricBConfig = getMetricType(corr.pair[1]);
          const labelA =
            metricAConfig?.label ?? corr.pair[0].replace(/_/g, " ");
          const labelB =
            metricBConfig?.label ?? corr.pair[1].replace(/_/g, " ");
          const directionArrow = corr.direction === "positive" ? "↔" : "↔";
          const directionLabel =
            corr.direction === "positive" ? "positive" : "inverse";
          const coeffFormatted =
            corr.coefficient >= 0
              ? `+${corr.coefficient.toFixed(2)}`
              : corr.coefficient.toFixed(2);
          const strengthColor =
            corr.strength === "strong"
              ? "text-foreground font-semibold"
              : corr.strength === "moderate"
                ? "text-foreground"
                : "text-muted-foreground";

          return (
            <div
              key={`${corr.pair[0]}-${corr.pair[1]}`}
              className="flex items-center justify-between text-sm"
              data-testid="correlation-entry"
            >
              <span>
                {labelA} {directionArrow} {labelB}
              </span>
              <span className={cn("text-xs", strengthColor)}>
                {coeffFormatted} ({corr.strength} {directionLabel})
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── TrendTooltip ──────────────────────────────────────────────

interface TrendTooltipProps {
  metricType: string;
  unit: string;
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color?: string }>;
  label?: string | number;
}

function TrendTooltip({
  metricType: _metricType,
  unit,
  active,
  payload,
  label,
}: TrendTooltipProps) {
  if (!active || !payload?.length || label == null) return null;

  const dateLabel = (() => {
    try {
      const d = typeof label === "number" ? new Date(label) : parseISO(label);
      return format(d, "MMM d, yyyy");
    } catch {
      return String(label);
    }
  })();

  const rawPayload = payload.find((p) => p.dataKey === "raw");
  const smoothedPayload = payload.find((p) => p.dataKey === "smoothed");

  return (
    <div
      className="rounded-lg border p-2 shadow-md"
      style={{
        backgroundColor: "var(--chart-tooltip-bg)",
        borderColor: "var(--chart-tooltip-border)",
        color: "var(--chart-tooltip-text)",
      }}
    >
      <p className="mb-1 text-[10px] font-medium">{dateLabel}</p>
      {rawPayload && rawPayload.value != null && (
        <p className="text-xs">
          <span className="text-muted-foreground mr-1">Raw:</span>
          <span className="font-medium">
            {formatValue(rawPayload.value)}
          </span>{" "}
          <span className="text-muted-foreground">{unit}</span>
        </p>
      )}
      {smoothedPayload && smoothedPayload.value != null && (
        <p className="text-xs">
          <span className="text-muted-foreground mr-1">Avg:</span>
          <span className="font-medium">
            {formatValue(smoothedPayload.value)}
          </span>{" "}
          <span className="text-muted-foreground">{unit}</span>
        </p>
      )}
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────

function formatValue(v: number): string {
  return v % 1 === 0 ? v.toString() : v.toFixed(1);
}
