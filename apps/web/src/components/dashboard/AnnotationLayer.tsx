"use client";

import { useMemo, useState } from "react";
import { parseISO, format } from "date-fns";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import type { Annotation } from "@/lib/dashboard/types";

/**
 * Icon map for annotation event types.
 */
const EVENT_ICONS: Record<string, string> = {
  meal: "🍽️",
  workout: "🏃",
  travel: "✈️",
  alcohol: "🍷",
  medication: "💊",
  supplement: "💊",
  custom: "📌",
};

interface AnnotationLayerProps {
  /** Annotation events to render as vertical markers */
  annotations: Annotation[];
  /** Start of the visible time range (ISO string) */
  start: string;
  /** End of the visible time range (ISO string) */
  end: string;
  /** Height of the annotation layer (should match total strip height) */
  height?: number;
  /** Whether the annotation data is currently loading */
  isLoading?: boolean;
}

/**
 * AnnotationLayer — vertical dotted lines at annotation timestamps
 * spanning across all MetricStrip panels, with hover tooltips
 * showing event details.
 *
 * Positioned as an overlay inside MetricStripContainer. Uses absolute
 * positioning with percentage-based left offsets calculated from the
 * time range.
 *
 * See: wireframes W1-W2, W6 in /docs/design/wireframes.md
 */
export function AnnotationLayer({
  annotations,
  start,
  end,
  height = 400,
  isLoading = false,
}: AnnotationLayerProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const timeRange = useMemo(() => {
    try {
      return {
        startMs: parseISO(start).getTime(),
        endMs: parseISO(end).getTime(),
      };
    } catch {
      return null;
    }
  }, [start, end]);

  const markers = useMemo(() => {
    if (!timeRange) return [];
    const { startMs, endMs } = timeRange;
    const rangeMs = endMs - startMs;
    if (rangeMs <= 0) return [];

    return annotations
      .map((a) => {
        try {
          const ts = parseISO(a.occurred_at).getTime();

          // For duration annotations (has ended_at), check if the event
          // overlaps the visible range — even if occurred_at is before start.
          const endedTs = a.ended_at
            ? parseISO(a.ended_at).getTime()
            : undefined;

          const pct = ((ts - startMs) / rangeMs) * 100;

          // Fully after the visible range → skip
          if (pct > 100) return null;

          // Before the visible range: clamp to left edge if the event
          // spans into the window (VAL-CROSS-024), otherwise skip.
          if (pct < 0) {
            if (endedTs != null && endedTs > startMs) {
              // Boundary-spanning annotation — render marker at chart start
              return {
                annotation: a,
                pct: 0,
                key: `${a.id ?? a.occurred_at}`,
              };
            }
            return null;
          }

          return { annotation: a, pct, key: `${a.id ?? a.occurred_at}` };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Array<{
      annotation: Annotation;
      pct: number;
      key: string;
    }>;
  }, [annotations, timeRange]);

  if (isLoading) {
    return (
      <div
        className="pointer-events-none absolute inset-0 flex items-start justify-center pt-2"
        style={{ height }}
        data-testid="annotation-layer-loading"
        aria-label="Loading annotations"
      >
        <div className="flex gap-6">
          <Skeleton className="h-6 w-6 rounded-full" />
          <Skeleton className="h-6 w-6 rounded-full" />
          <Skeleton className="h-6 w-6 rounded-full" />
        </div>
      </div>
    );
  }

  if (markers.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ height }}
      data-testid="annotation-layer"
      aria-label="Event annotations"
    >
      {markers.map(({ annotation, pct, key }) => {
        const icon = EVENT_ICONS[annotation.event_type] ?? "📌";
        const isHovered = hoveredId === key;
        let formattedTime: string;
        try {
          formattedTime = format(parseISO(annotation.occurred_at), "h:mm a");
        } catch {
          formattedTime = annotation.occurred_at;
        }

        return (
          <div
            key={key}
            className="pointer-events-auto absolute top-0 bottom-0"
            style={{ left: `${pct}%` }}
          >
            {/* Vertical dotted line */}
            <div
              className="absolute inset-y-0 w-px border-l border-dashed border-[var(--chart-annotation-line,#94a3b8)]"
              aria-hidden="true"
            />

            {/* Marker icon at top */}
            <button
              type="button"
              className={cn(
                "absolute -top-1 -translate-x-1/2 cursor-pointer text-xs",
                "transition-transform hover:scale-125",
              )}
              onMouseEnter={() => setHoveredId(key)}
              onMouseLeave={() => setHoveredId(null)}
              onFocus={() => setHoveredId(key)}
              onBlur={() => setHoveredId(null)}
              aria-label={`${annotation.event_type}: ${annotation.label}`}
              data-testid="annotation-marker"
            >
              <span aria-hidden="true">{icon}</span>
              <span className="text-muted-foreground block text-[8px] leading-tight">
                {annotation.event_type}
              </span>
            </button>

            {/* Hover tooltip */}
            {isHovered && (
              <div
                className="bg-popover border-border absolute top-8 z-50 -translate-x-1/2 rounded-lg border p-2 shadow-md"
                style={{ minWidth: 140 }}
                role="tooltip"
                data-testid="annotation-tooltip"
              >
                <p className="text-xs font-semibold">{annotation.label}</p>
                <p className="text-muted-foreground text-[10px]">
                  {formattedTime} · {annotation.event_type}
                </p>
                {annotation.note && (
                  <p className="text-muted-foreground mt-1 text-[10px]">
                    {annotation.note}
                  </p>
                )}
                {annotation.source !== "user" && (
                  <p className="text-muted-foreground mt-1 text-[10px] italic">
                    Source: {annotation.source}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
