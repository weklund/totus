"use client";

import { useMemo, useState } from "react";
import { Activity, Loader2 } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorCard } from "@/components/dashboard/ErrorCard";
import { AuditEventRow } from "./AuditEventRow";
import { AuditFilters } from "./AuditFilters";
import { useAuditLog } from "@/hooks/useAuditLog";
import type { AuditFilters as AuditFiltersType } from "@/hooks/useAuditLog";

/**
 * AuditTable — paginated, filterable table of audit events.
 *
 * Uses useAuditLog() with infinite query for cursor-based pagination.
 * Filter changes reset the query and start a new cursor chain.
 */
export function AuditTable() {
  const [filters, setFilters] = useState<AuditFiltersType>({});

  const {
    data,
    isLoading,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    refetch,
  } = useAuditLog(filters);

  const events = useMemo(
    () => data?.pages.flatMap((page) => page.data) ?? [],
    [data],
  );

  return (
    <div className="space-y-4" data-testid="audit-table">
      <AuditFilters filters={filters} onFiltersChange={setFilters} />

      {isLoading && (
        <div className="space-y-2" data-testid="audit-loading">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      )}

      {error && (
        <ErrorCard
          title="Failed to load activity log"
          message={error.message || "Could not load audit events."}
          onRetry={() => refetch()}
        />
      )}

      {!isLoading && !error && events.length === 0 && (
        <div
          className="flex flex-col items-center justify-center gap-4 py-16"
          data-testid="audit-empty"
        >
          <div className="bg-muted flex size-16 items-center justify-center rounded-full">
            <Activity className="text-muted-foreground size-8" />
          </div>
          <div className="text-center">
            <p className="font-medium">No activity recorded yet</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Activity will appear here as you use Totus.
            </p>
          </div>
        </div>
      )}

      {!isLoading && !error && events.length > 0 && (
        <TooltipProvider>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="w-40">Time</TableHead>
                <TableHead className="w-24">Actor</TableHead>
                <TableHead>Event</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <AuditEventRow key={event.id} event={event} />
              ))}
            </TableBody>
          </Table>
        </TooltipProvider>
      )}

      {hasNextPage && (
        <div className="flex justify-center pt-4">
          <Button
            variant="outline"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="gap-1.5"
            data-testid="audit-load-more"
          >
            {isFetchingNextPage && <Loader2 className="size-4 animate-spin" />}
            Load More
          </Button>
        </div>
      )}
    </div>
  );
}
