import { Suspense } from "react";
import { AuditTable } from "@/components/audit/AuditTable";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Audit log page — RSC shell with client AuditTable component.
 *
 * Displays a paginated, filterable table of all audit events.
 * The page title "Activity Log" is rendered by the Header component via pathname detection.
 *
 * See: /docs/web-ui-lld.md Section 7.6
 */
export default function AuditPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Activity Log</h2>
        <p className="text-muted-foreground text-sm">
          See all activity on your account — data access, shares, and account
          changes.
        </p>
      </div>

      <Suspense fallback={<AuditSkeleton />}>
        <AuditTable />
      </Suspense>
    </div>
  );
}

function AuditSkeleton() {
  return (
    <div className="space-y-4">
      {/* Filter skeletons */}
      <div className="flex gap-3">
        <Skeleton className="h-9 w-[180px]" />
        <Skeleton className="h-9 w-[140px]" />
        <Skeleton className="h-9 w-[140px]" />
        <Skeleton className="h-9 w-[140px]" />
      </div>
      {/* Row skeletons */}
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-md" />
      ))}
    </div>
  );
}
