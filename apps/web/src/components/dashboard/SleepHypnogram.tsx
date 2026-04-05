"use client";

import { useMemo } from "react";
import { parseISO, differenceInMinutes, format } from "date-fns";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";

export interface HypnogramSegment {
  /** Sleep stage: "awake" | "light" | "deep" | "rem" */
  stage: string;
  /** ISO timestamp of when the stage started */
  start: string;
  /** ISO timestamp of when the stage ended */
  end: string;
}

interface SleepHypnogramProps {
  /** Array of sleep stage segments from the API */
  segments: HypnogramSegment[];
  /** Start of the visible time range (ISO string) */
  timeStart: string;
  /** End of the visible time range (ISO string) */
  timeEnd: string;
  /** Whether loading */
  isLoading?: boolean;
}

const STAGE_COLORS: Record<string, string> = {
  awake: "bg-amber-400 dark:bg-amber-500",
  light: "bg-sky-400 dark:bg-sky-500",
  deep: "bg-indigo-700 dark:bg-indigo-600",
  rem: "bg-purple-500 dark:bg-purple-400",
};

const STAGE_LABELS: Record<string, string> = {
  awake: "Awake",
  light: "Light",
  deep: "Deep",
  rem: "REM",
};

const STAGE_ORDER = ["awake", "light", "deep", "rem"] as const;

/**
 * SleepHypnogram — horizontal bar visualization of sleep stages
 * (awake/light/deep/REM) aligned to the shared time axis.
 *
 * Each row represents one sleep stage. Segments are positioned using
 * percentage offsets based on the time range, so they align with the
 * MetricStrip panels above.
 *
 * See: wireframes W1, W6 in /docs/design/wireframes.md
 */
export function SleepHypnogram({
  segments,
  timeStart,
  timeEnd,
  isLoading = false,
}: SleepHypnogramProps) {
  const timeRange = useMemo(() => {
    try {
      return {
        startMs: parseISO(timeStart).getTime(),
        endMs: parseISO(timeEnd).getTime(),
      };
    } catch {
      return null;
    }
  }, [timeStart, timeEnd]);

  const stageRows = useMemo(() => {
    if (!timeRange || segments.length === 0) return null;
    const { startMs, endMs } = timeRange;
    const rangeMs = endMs - startMs;
    if (rangeMs <= 0) return null;

    const rows: Record<
      string,
      Array<{ leftPct: number; widthPct: number }>
    > = {};

    for (const stage of STAGE_ORDER) {
      rows[stage] = [];
    }

    for (const seg of segments) {
      try {
        const segStart = Math.max(parseISO(seg.start).getTime(), startMs);
        const segEnd = Math.min(parseISO(seg.end).getTime(), endMs);
        if (segEnd <= segStart) continue;

        const leftPct = ((segStart - startMs) / rangeMs) * 100;
        const widthPct = ((segEnd - segStart) / rangeMs) * 100;

        const stage = seg.stage.toLowerCase();
        if (rows[stage]) {
          rows[stage].push({ leftPct, widthPct });
        }
      } catch {
        // Skip invalid segments
      }
    }

    return rows;
  }, [segments, timeRange]);

  // Compute total sleep duration
  const totalDuration = useMemo(() => {
    let totalMin = 0;
    for (const seg of segments) {
      try {
        totalMin += differenceInMinutes(parseISO(seg.end), parseISO(seg.start));
      } catch {
        // Skip invalid
      }
    }
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  }, [segments]);

  if (isLoading) {
    return (
      <div data-testid="hypnogram-loading">
        <Skeleton className="mb-2 h-4 w-32" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    );
  }

  if (!stageRows || segments.length === 0) {
    return (
      <div
        className="text-muted-foreground flex h-24 items-center justify-center rounded-lg border border-dashed"
        data-testid="hypnogram-empty"
      >
        <p className="text-sm">No sleep stage data available</p>
      </div>
    );
  }

  return (
    <div data-testid="sleep-hypnogram">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium">Sleep Stages</span>
        <span className="text-muted-foreground text-xs">{totalDuration}</span>
      </div>

      {/* Legend */}
      <div className="mb-2 flex flex-wrap gap-3">
        {STAGE_ORDER.map((stage) => (
          <div key={stage} className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-block size-2.5 rounded-sm",
                STAGE_COLORS[stage],
              )}
              aria-hidden="true"
            />
            <span className="text-muted-foreground text-[10px]">
              {STAGE_LABELS[stage]}
            </span>
          </div>
        ))}
      </div>

      {/* Stage rows */}
      <div className="space-y-1" role="img" aria-label="Sleep hypnogram">
        {STAGE_ORDER.map((stage) => {
          const bars = stageRows[stage] ?? [];
          return (
            <div key={stage} className="flex items-center gap-2">
              <span className="text-muted-foreground w-12 text-right text-[10px]">
                {STAGE_LABELS[stage]}
              </span>
              <div className="bg-muted/30 relative h-5 flex-1 overflow-hidden rounded">
                {bars.map((bar, i) => (
                  <div
                    key={i}
                    className={cn(
                      "absolute top-0 h-full rounded-sm",
                      STAGE_COLORS[stage],
                    )}
                    style={{
                      left: `${bar.leftPct}%`,
                      width: `${Math.max(bar.widthPct, 0.3)}%`,
                    }}
                    aria-hidden="true"
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Time axis labels */}
      {timeRange && (
        <div className="mt-1 flex justify-between">
          <span className="text-muted-foreground text-[10px]">
            {formatTime(timeStart)}
          </span>
          <span className="text-muted-foreground text-[10px]">
            {formatTime(timeEnd)}
          </span>
        </div>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    return format(parseISO(iso), "h:mm a");
  } catch {
    return iso;
  }
}
