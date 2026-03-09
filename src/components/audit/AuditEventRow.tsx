"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TableRow, TableCell } from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AuditEvent } from "@/hooks/useAuditLog";

interface AuditEventRowProps {
  event: AuditEvent;
}

function getActorBadge(actorType: string) {
  switch (actorType) {
    case "owner":
      return (
        <Badge variant="default" className="text-[10px]">
          YOU
        </Badge>
      );
    case "viewer":
      return (
        <Badge variant="secondary" className="text-[10px]">
          VIEWER
        </Badge>
      );
    case "system":
      return (
        <Badge variant="outline" className="text-[10px]">
          SYSTEM
        </Badge>
      );
    default:
      return null;
  }
}

export function AuditEventRow({ event }: AuditEventRowProps) {
  const [expanded, setExpanded] = useState(false);

  const relativeTime = formatDistanceToNow(new Date(event.created_at), {
    addSuffix: true,
  });
  const absoluteTime = new Date(event.created_at).toLocaleString();

  const hasDetails =
    event.ip_address || event.user_agent || event.resource_detail;

  return (
    <>
      <TableRow
        className={hasDetails ? "cursor-pointer" : ""}
        onClick={() => hasDetails && setExpanded(!expanded)}
        data-testid={`audit-event-${event.id}`}
      >
        <TableCell className="w-8">
          {hasDetails && (
            <button
              aria-label={expanded ? "Collapse details" : "Expand details"}
              className="text-muted-foreground hover:text-foreground"
            >
              {expanded ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </button>
          )}
        </TableCell>
        <TableCell className="whitespace-nowrap">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-muted-foreground text-xs">
                {relativeTime}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{absoluteTime}</p>
            </TooltipContent>
          </Tooltip>
        </TableCell>
        <TableCell>{getActorBadge(event.actor_type)}</TableCell>
        <TableCell className="max-w-md truncate">{event.description}</TableCell>
      </TableRow>
      {expanded && hasDetails && (
        <TableRow data-testid={`audit-event-detail-${event.id}`}>
          <TableCell />
          <TableCell colSpan={3}>
            <div className="bg-muted/50 space-y-1 rounded-md p-3 text-xs">
              {event.ip_address && (
                <p>
                  <span className="text-muted-foreground font-medium">
                    IP Address:{" "}
                  </span>
                  {event.ip_address}
                </p>
              )}
              {event.user_agent && (
                <p>
                  <span className="text-muted-foreground font-medium">
                    User Agent:{" "}
                  </span>
                  <span className="break-all">{event.user_agent}</span>
                </p>
              )}
              {event.resource_detail && (
                <p>
                  <span className="text-muted-foreground font-medium">
                    Details:{" "}
                  </span>
                  <span className="break-all">
                    {JSON.stringify(event.resource_detail)}
                  </span>
                </p>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
