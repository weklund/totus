import { Suspense } from "react";
import { DashboardViewRouter } from "@/components/dashboard/DashboardViewRouter";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Dashboard page — RSC shell that renders the DashboardViewRouter client component.
 *
 * URL params control view and date:
 *   /dashboard?view=night&date=2026-03-28
 *
 * Defaults to Night view for the current date on first load.
 * The layout handles auth gating and ViewContext injection.
 */
export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardViewRouter />
    </Suspense>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      {/* DateNavigation skeleton */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="h-8 w-40 rounded-md" />
          <Skeleton className="size-8 rounded-md" />
        </div>
        <Skeleton className="h-8 w-48 rounded-lg" />
      </div>
      {/* View content skeleton */}
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-lg" />
      <Skeleton className="h-20 w-full rounded-lg" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-xl" />
    </div>
  );
}
