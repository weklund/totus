"use client";

import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { Moon, Dumbbell, UtensilsCrossed } from "lucide-react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceBadge } from "./SourceBadge";
import type { PeriodEvent } from "@/hooks/usePeriodsData";

interface PeriodTimelineProps {
  /** Event type identifier (e.g., 'sleep_stage', 'workout', 'meal') */
  eventType: string;
  /** Period events to display */
  periods: PeriodEvent[];
  /** Whether the chart is loading */
  isLoading?: boolean;
}

/**
 * PeriodTimeline — visual timeline for duration events.
 *
 * Renders sleep stages as colored horizontal bars (hypnogram-style),
 * workouts as event cards, and meals as event cards.
 *
 * Includes loading skeleton and empty state.
 *
 * See: /docs/web-ui-lld.md Section 8.5
 */
export function PeriodTimeline({
  eventType,
  periods,
  isLoading = false,
}: PeriodTimelineProps) {
  const eventLabel = EVENT_TYPE_LABELS[eventType] ?? eventType;

  if (isLoading) {
    return (
      <div data-testid="period-timeline-loading">
        <Skeleton className="mb-2 h-4 w-32" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!periods || periods.length === 0) {
    return (
      <div
        className="text-muted-foreground flex h-[200px] flex-col items-center justify-center rounded-lg border border-dashed"
        data-testid="period-timeline-empty"
      >
        <p className="text-sm">No {eventLabel.toLowerCase()} data available</p>
      </div>
    );
  }

  if (eventType === "sleep_stage") {
    return <SleepStageTimeline periods={periods} />;
  }

  return <EventCardList eventType={eventType} periods={periods} />;
}

// ─── Sleep Stage Hypnogram ─────────────────────────────────

const STAGE_COLORS: Record<string, string> = {
  rem: "bg-purple-500",
  deep: "bg-indigo-700",
  light: "bg-sky-400",
  awake: "bg-amber-400",
};

const STAGE_LABELS: Record<string, string> = {
  rem: "REM",
  deep: "Deep",
  light: "Light",
  awake: "Awake",
};

const STAGE_ORDER = ["awake", "rem", "light", "deep"];

function SleepStageTimeline({ periods }: { periods: PeriodEvent[] }) {
  // Group by night (date of started_at)
  const nightGroups = useMemo(() => {
    const groups = new Map<string, PeriodEvent[]>();
    for (const period of periods) {
      try {
        const d = parseISO(period.started_at);
        const dateKey = format(d, "yyyy-MM-dd");
        const list = groups.get(dateKey) || [];
        list.push(period);
        groups.set(dateKey, list);
      } catch {
        // Skip invalid timestamps
      }
    }
    // Sort by date descending (most recent first)
    return Array.from(groups.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, events]) => ({
        date,
        events: events.sort((a, b) => a.started_at.localeCompare(b.started_at)),
      }));
  }, [periods]);

  const source = periods[0]?.source;

  return (
    <div data-testid="period-timeline">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-muted-foreground text-xs font-medium">
          Sleep Stages
        </h4>
        {source && <SourceBadge provider={source} showName size="sm" />}
      </div>

      {/* Legend */}
      <div className="mb-3 flex flex-wrap gap-3">
        {STAGE_ORDER.map((stage) => (
          <div key={stage} className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-block size-2.5 rounded-sm",
                STAGE_COLORS[stage],
              )}
            />
            <span className="text-muted-foreground text-[10px]">
              {STAGE_LABELS[stage]}
            </span>
          </div>
        ))}
      </div>

      {/* Night rows */}
      <div className="space-y-3">
        {nightGroups.map(({ date, events }) => {
          const totalDuration = events.reduce(
            (acc, e) => acc + e.duration_sec,
            0,
          );

          return (
            <div key={date} data-testid={`sleep-night-${date}`}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-muted-foreground text-[10px]">
                  {formatNightLabel(date)}
                </span>
                <span className="text-muted-foreground text-[10px]">
                  {formatDuration(totalDuration)}
                </span>
              </div>
              <div className="flex h-6 w-full overflow-hidden rounded">
                {events.map((event, i) => {
                  const widthPct =
                    totalDuration > 0
                      ? (event.duration_sec / totalDuration) * 100
                      : 0;

                  return (
                    <div
                      key={i}
                      className={cn(
                        "h-full transition-opacity hover:opacity-80",
                        STAGE_COLORS[event.subtype] ?? "bg-gray-400",
                      )}
                      style={{ width: `${widthPct}%` }}
                      title={`${STAGE_LABELS[event.subtype] ?? event.subtype}: ${formatDuration(event.duration_sec)}`}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Event Cards (Workouts, Meals) ─────────────────────────

const EVENT_TYPE_LABELS: Record<string, string> = {
  sleep_stage: "Sleep Stages",
  workout: "Workouts",
  meal: "Meals",
};

const EVENT_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  sleep_stage: Moon,
  workout: Dumbbell,
  meal: UtensilsCrossed,
};

function EventCardList({
  eventType,
  periods,
}: {
  eventType: string;
  periods: PeriodEvent[];
}) {
  const Icon = EVENT_ICONS[eventType] ?? Dumbbell;
  const label = EVENT_TYPE_LABELS[eventType] ?? eventType;
  const source = periods[0]?.source;

  // Sort by date descending
  const sorted = useMemo(
    () => [...periods].sort((a, b) => b.started_at.localeCompare(a.started_at)),
    [periods],
  );

  return (
    <div data-testid="period-timeline">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-muted-foreground text-xs font-medium">{label}</h4>
        {source && <SourceBadge provider={source} showName size="sm" />}
      </div>
      <div className="space-y-2">
        {sorted.map((period, i) => (
          <div
            key={i}
            className="border-border bg-card flex items-center gap-3 rounded-lg border p-3"
            data-testid={`period-event-${eventType}`}
          >
            <div className="bg-muted flex size-8 items-center justify-center rounded-full">
              <Icon className="text-muted-foreground size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium capitalize">
                  {period.subtype}
                </span>
                <span className="text-muted-foreground text-[10px]">
                  {formatEventTime(period.started_at)}
                </span>
              </div>
              <span className="text-muted-foreground text-xs">
                {formatDuration(period.duration_sec)}
              </span>
            </div>
            <SourceBadge provider={period.source} size="sm" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Formatting Helpers ────────────────────────────────────

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatNightLabel(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "EEE, MMM d");
  } catch {
    return dateStr;
  }
}

function formatEventTime(timestamp: string): string {
  try {
    return format(parseISO(timestamp), "MMM d, h:mm a");
  } catch {
    return timestamp;
  }
}
