"use client";

import { Info } from "lucide-react";
import { useViewContext } from "@/lib/view-context";
import { getMetricType } from "@/config/metrics";
import { format, parseISO } from "date-fns";

/**
 * ViewerBanner — informational banner showing what data is being shared.
 *
 * Displays the shared metrics and date range in a clear, non-intrusive banner.
 *
 * See: /docs/web-ui-lld.md Section 7.8
 */
export function ViewerBanner() {
  const { permissions } = useViewContext();

  const metricLabels =
    permissions.metrics === "all"
      ? "all metrics"
      : (permissions.metrics as string[])
          .map((m) => getMetricType(m)?.label ?? m)
          .join(", ");

  const startFormatted = permissions.dataStart
    ? format(parseISO(permissions.dataStart), "MMM d, yyyy")
    : "start";
  const endFormatted = permissions.dataEnd
    ? format(parseISO(permissions.dataEnd), "MMM d, yyyy")
    : "end";

  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-900 dark:bg-blue-950"
      data-testid="viewer-banner"
    >
      <Info className="mt-0.5 size-4 shrink-0 text-blue-600 dark:text-blue-400" />
      <p className="text-sm text-blue-800 dark:text-blue-200">
        You are viewing shared health data: {metricLabels} from {startFormatted}{" "}
        to {endFormatted}.
      </p>
    </div>
  );
}
