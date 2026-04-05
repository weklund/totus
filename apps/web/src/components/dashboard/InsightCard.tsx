"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Insight } from "@/lib/dashboard/types";

interface InsightCardProps {
  /** Insight data from the API */
  insight: Insight;
  /** Callback when the user dismisses the insight */
  onDismiss?: (type: string) => void;
  /** Whether the dismiss action is in progress */
  isDismissing?: boolean;
}

/**
 * InsightCard — narrative card with title, body, severity badge,
 * related_metrics tags, and dismiss button.
 *
 * Conditionally rendered — do not render when there are no insights.
 * When dismissed, the card should be removed from the DOM (not hidden).
 *
 * See: wireframes W1-W2, W6 in /docs/design/wireframes.md
 */
export function InsightCard({
  insight,
  onDismiss,
  isDismissing = false,
}: InsightCardProps) {
  return (
    <div
      className={cn(
        "bg-card relative rounded-xl border p-4",
        insight.severity === "warning"
          ? "border-[#E8845A]/30 bg-[#E8845A]/5"
          : "border-border",
      )}
      role="article"
      aria-label={`Insight: ${insight.title}`}
      data-testid="insight-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Title row with emoji + severity badge */}
          <div className="mb-2 flex items-center gap-2">
            <span aria-hidden="true">💡</span>
            <span className="text-sm font-semibold">{insight.title}</span>
            <Badge
              variant={
                insight.severity === "warning" ? "destructive" : "secondary"
              }
              className="text-[10px]"
              data-testid="insight-severity"
            >
              {insight.severity}
            </Badge>
          </div>

          {/* Body text */}
          <p className="text-muted-foreground mb-3 text-sm leading-relaxed">
            {insight.body}
          </p>

          {/* Related metrics tags */}
          {insight.related_metrics.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <span className="text-muted-foreground text-[10px]">
                Related:
              </span>
              {insight.related_metrics.map((metric) => (
                <Badge
                  key={metric}
                  variant="outline"
                  className="text-[10px]"
                  data-testid="insight-metric-tag"
                >
                  {metric.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Dismiss button */}
        {insight.dismissible && onDismiss && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onDismiss(insight.type)}
            disabled={isDismissing}
            aria-label={`Dismiss insight: ${insight.title}`}
            data-testid="insight-dismiss"
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
