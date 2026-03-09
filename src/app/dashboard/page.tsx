import { Suspense } from "react";
import { DashboardContent } from "@/components/dashboard/DashboardContent";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Dashboard page — RSC shell that renders the DashboardContent client component.
 *
 * The layout handles auth gating and ViewContext injection.
 * Query params (?connected=oura and ?error=) are handled by DashboardContent
 * via useSearchParams for OAuth callback toasts.
 */
export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Toolbar skeleton */}
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-24 rounded-full" />
          ))}
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-12" />
          ))}
        </div>
      </div>
      {/* Chart skeleton */}
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-[350px] rounded-lg" />
        ))}
      </div>
    </div>
  );
}
