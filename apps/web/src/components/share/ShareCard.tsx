"use client";

import { format, formatDistanceToNow } from "date-fns";
import { Eye, Trash2, Ban, Calendar, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getMetricColor } from "@/lib/chart-utils";
import { METRIC_TYPES } from "@/config/metrics";
import { cn } from "@/lib/cn";
import type { ShareGrant } from "@/hooks/useShares";

interface ShareCardProps {
  share: ShareGrant;
  onRevoke: (id: string) => void;
  onDelete: (id: string) => void;
}

const STATUS_CONFIG = {
  active: {
    label: "Active",
    variant: "default" as const,
    className: "bg-green-500/10 text-green-700 dark:text-green-400",
  },
  expired: {
    label: "Expired",
    variant: "secondary" as const,
    className: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  },
  revoked: {
    label: "Revoked",
    variant: "destructive" as const,
    className: "bg-red-500/10 text-red-700 dark:text-red-400",
  },
};

function getMetricLabel(metricId: string): string {
  return METRIC_TYPES.get(metricId)?.label ?? metricId.replace(/_/g, " ");
}

export function ShareCard({ share, onRevoke, onDelete }: ShareCardProps) {
  const statusConfig = STATUS_CONFIG[share.status];
  const canRevoke = share.status === "active";
  const canDelete = share.status === "revoked" || share.status === "expired";

  return (
    <Card data-testid={`share-card-${share.id}`}>
      <CardContent className="pt-6">
        <div className="space-y-3">
          {/* Header: Label + Status */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h4 className="truncate text-sm font-semibold">{share.label}</h4>
            </div>
            <Badge
              variant="outline"
              className={cn("shrink-0", statusConfig.className)}
            >
              {statusConfig.label}
            </Badge>
          </div>

          {/* Metric chips */}
          <div className="flex flex-wrap gap-1">
            {share.allowed_metrics.map((metricId) => {
              const color = getMetricColor(metricId);
              return (
                <Badge
                  key={metricId}
                  variant="secondary"
                  className="gap-1 text-xs"
                >
                  <span
                    className="inline-block size-1.5 rounded-full"
                    style={{ backgroundColor: color.line }}
                  />
                  {getMetricLabel(metricId)}
                </Badge>
              );
            })}
          </div>

          {/* Date range + expiration */}
          <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className="flex items-center gap-1">
              <Calendar className="size-3" />
              {format(
                new Date(share.data_start + "T00:00:00"),
                "MMM d, yyyy",
              )}{" "}
              – {format(new Date(share.data_end + "T00:00:00"), "MMM d, yyyy")}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              {share.status === "expired"
                ? "Expired"
                : share.status === "revoked"
                  ? `Revoked ${share.revoked_at ? formatDistanceToNow(new Date(share.revoked_at), { addSuffix: true }) : ""}`
                  : `Expires ${formatDistanceToNow(new Date(share.grant_expires), { addSuffix: true })}`}
            </span>
            <span className="flex items-center gap-1">
              <Eye className="size-3" />
              {share.view_count} views
            </span>
          </div>

          {/* Note preview */}
          {share.note && (
            <p className="text-muted-foreground line-clamp-2 text-xs italic">
              &ldquo;{share.note}&rdquo;
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            {canRevoke && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRevoke(share.id)}
                className="gap-1.5 text-orange-600 hover:text-orange-700"
              >
                <Ban className="size-3.5" />
                Revoke
              </Button>
            )}
            {canDelete && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDelete(share.id)}
                className="text-destructive hover:text-destructive gap-1.5"
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
