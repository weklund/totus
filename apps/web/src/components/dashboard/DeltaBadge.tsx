"use client";

import { cn } from "@/lib/cn";
import type { SummaryMetric } from "@/lib/dashboard/types";

interface DeltaBadgeProps {
  /** The delta value (value - avg_30d) */
  delta: number;
  /** Polarity-aware direction: "better" | "worse" | "neutral" */
  direction: SummaryMetric["direction"];
  /** Display unit (e.g., "bpm", "ms", "min") */
  unit?: string;
  /** Optional metric label for screen reader context */
  metricLabel?: string;
  /** Compact mode — just color dot + delta, no "vs avg" text */
  compact?: boolean;
}

/**
 * DeltaBadge — shows a delta-from-average value with polarity-aware color
 * and directional arrow.
 *
 * - Coral (#E8845A) for "worse" (bad deviation from baseline)
 * - Emerald (#2FA87B) for "better" (good deviation from baseline)
 * - Slate for "neutral" (neither better nor worse)
 * - Arrow direction (▲/▼) follows the sign of the delta
 *
 * See: wireframes W1, W6 in /docs/design/wireframes.md
 */
export function DeltaBadge({
  delta,
  direction,
  unit = "",
  metricLabel,
  compact = false,
}: DeltaBadgeProps) {
  const isPositive = delta > 0;
  const isZero = delta === 0;
  const arrow = isZero ? "" : isPositive ? "▲" : "▼";
  const absValue = Math.abs(delta);
  const formattedValue =
    absValue % 1 === 0 ? absValue.toString() : absValue.toFixed(1);

  const colorClass = getDirectionColor(direction);

  const ariaLabel = metricLabel
    ? `${metricLabel}: ${direction === "neutral" ? "" : direction + ", "}${isPositive ? "up" : "down"} ${formattedValue}${unit ? " " + unit : ""} from average`
    : undefined;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium",
        colorClass,
      )}
      role="status"
      aria-label={ariaLabel}
      data-testid="delta-badge"
    >
      <span aria-hidden="true">{arrow}</span>
      <span>
        {formattedValue}
        {unit ? ` ${unit}` : ""}
      </span>
      {!compact && (
        <span className="text-muted-foreground ml-0.5 text-[10px] font-normal">
          vs avg
        </span>
      )}
    </span>
  );
}

function getDirectionColor(direction: SummaryMetric["direction"]): string {
  switch (direction) {
    case "worse":
      return "text-[#E8845A]";
    case "better":
      return "text-[#2FA87B]";
    case "neutral":
    default:
      return "text-muted-foreground";
  }
}
