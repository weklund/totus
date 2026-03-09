"use client";

import { format, parseISO } from "date-fns";
import { getMetricColor } from "@/lib/chart-utils";
import { getMetricType } from "@/config/metrics";

interface ChartTooltipProps {
  metrics: string[];
  active?: boolean;
  payload?: Array<{
    dataKey: string;
    value: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }>;
  label?: string;
}

export function ChartTooltip({
  metrics,
  active,
  payload,
  label,
}: ChartTooltipProps) {
  if (!active || !payload?.length || !label) return null;

  return (
    <div
      className="rounded-lg border p-3 shadow-md"
      style={{
        backgroundColor: "var(--chart-tooltip-bg)",
        borderColor: "var(--chart-tooltip-border)",
        color: "var(--chart-tooltip-text)",
      }}
    >
      <p className="mb-1.5 text-xs font-medium">
        {format(parseISO(label), "MMMM d, yyyy")}
      </p>
      {metrics.map((metric) => {
        const entry = payload.find((p) => p.dataKey === metric);
        if (!entry || entry.value == null) return null;

        const config = getMetricType(metric);
        const color = getMetricColor(metric);

        return (
          <div key={metric} className="flex items-center gap-2 text-xs">
            <span
              className="inline-block size-2 rounded-full"
              style={{ backgroundColor: color.line }}
            />
            <span className="font-medium">{config?.label ?? metric}:</span>
            <span>
              {typeof entry.value === "number"
                ? entry.value % 1 === 0
                  ? entry.value
                  : entry.value.toFixed(1)
                : entry.value}
            </span>
            <span className="text-muted-foreground">{config?.unit ?? ""}</span>
          </div>
        );
      })}
    </div>
  );
}
