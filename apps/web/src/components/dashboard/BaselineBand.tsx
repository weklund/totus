"use client";

import { ReferenceArea } from "recharts";
import { getMetricColor } from "@/lib/chart-utils";
import type { BaselinePayload } from "@/lib/dashboard/types";

interface BaselineBandProps {
  /** Baseline statistics for the metric */
  baseline: BaselinePayload;
  /** Metric type ID — used to derive the band color */
  metricType: string;
  /** Y-axis ID when used in a ComposedChart with multiple axes */
  yAxisId?: string;
}

/** Minimum data points for baseline band to render (VAL-CROSS-018). */
const MIN_HISTORY_FOR_BAND = 14;

/**
 * BaselineBand — Recharts ReferenceArea showing the personal normal range
 * (30-day avg ± 1 SD) as a shaded region at the metric's chart color
 * with 10% opacity.
 *
 * When the baseline's sample_count is below 14, the band is suppressed
 * entirely to avoid rendering misleading normal ranges from insufficient
 * history (VAL-CROSS-018).
 *
 * Must be rendered as a child of a Recharts chart component.
 *
 * See: wireframes W1-W3, W6 in /docs/design/wireframes.md
 */
export function BaselineBand({
  baseline,
  metricType,
  yAxisId,
}: BaselineBandProps) {
  // Suppress band when baseline history is insufficient (VAL-CROSS-018)
  if (baseline.sample_count < MIN_HISTORY_FOR_BAND) {
    return null;
  }

  const color = getMetricColor(metricType);

  return (
    <ReferenceArea
      y1={baseline.lower}
      y2={baseline.upper}
      yAxisId={yAxisId ?? "y-0"}
      fill={color.line}
      fillOpacity={0.12}
      stroke="none"
      data-testid="baseline-band"
      label={{
        value: `avg ${formatNum(baseline.avg_30d)}`,
        position: "insideTopRight",
        fontSize: 9,
        fill: "var(--chart-axis-label)",
      }}
    />
  );
}

function formatNum(n: number): string {
  return n % 1 === 0 ? n.toString() : n.toFixed(1);
}
