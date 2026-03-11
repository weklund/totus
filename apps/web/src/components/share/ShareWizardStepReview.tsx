"use client";

import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getMetricColor } from "@/lib/chart-utils";
import { METRIC_TYPES } from "@/config/metrics";

interface ShareWizardStepReviewProps {
  selectedMetrics: string[];
  dateRange: { start: string; end: string };
  expiresInDays: number;
  label: string;
  note: string;
}

export function ShareWizardStepReview({
  selectedMetrics,
  dateRange,
  expiresInDays,
  label,
  note,
}: ShareWizardStepReviewProps) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">Review</h3>
        <p className="text-muted-foreground text-sm">
          Review your share settings before creating the link.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          {/* Label */}
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Label
            </p>
            <p className="text-sm font-medium">{label || "Untitled share"}</p>
          </div>

          {/* Metrics */}
          <div>
            <p className="text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase">
              Metrics ({selectedMetrics.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {selectedMetrics.map((metricId) => {
                const metricType = METRIC_TYPES.get(metricId);
                const color = getMetricColor(metricId);
                return (
                  <Badge key={metricId} variant="secondary" className="gap-1">
                    <span
                      className="inline-block size-2 rounded-full"
                      style={{ backgroundColor: color.line }}
                    />
                    {metricType?.label ?? metricId}
                  </Badge>
                );
              })}
            </div>
          </div>

          {/* Date Range */}
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Date Range
            </p>
            <p className="text-sm">
              {format(new Date(dateRange.start + "T00:00:00"), "MMM d, yyyy")} –{" "}
              {format(new Date(dateRange.end + "T00:00:00"), "MMM d, yyyy")}
            </p>
          </div>

          {/* Expiration */}
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Link Expires In
            </p>
            <p className="text-sm">{expiresInDays} days</p>
          </div>

          {/* Note */}
          {note && (
            <div>
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Note
              </p>
              <p className="text-muted-foreground text-sm">{note}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
