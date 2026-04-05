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

/**
 * BaselineBand — Recharts ReferenceArea showing the personal normal range
 * (30-day avg ± 1 SD) as a shaded region at the metric's chart color
 * with 10% opacity.
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
  const color = getMetricColor(metricType);

  return (
    <ReferenceArea
      y1={baseline.lower}
      y2={baseline.upper}
      yAxisId={yAxisId ?? "y-0"}
      fill={color.line}
      fillOpacity={0.1}
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
