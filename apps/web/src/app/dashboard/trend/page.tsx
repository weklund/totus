"use client";

import { useCallback } from "react";
import { format } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import { DateNavigation } from "@/components/dashboard/DateNavigation";
import { TrendDetailView } from "@/components/dashboard/TrendDetailView";
import type { ViewType } from "@/lib/dashboard/types";

/**
 * Trend View page — dashboard route for viewing 30-day (or other range) trend data.
 *
 * Reads date from URL search params for deep-linkable state.
 * View switching navigates to the main dashboard route with URL params.
 *
 * See: wireframe W3 and scenario S4 (Doctor Visit Preparation)
 */
export default function TrendViewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read date from URL search params, default to today
  const date = searchParams.get("date") ?? format(new Date(), "yyyy-MM-dd");

  const handleDateChange = useCallback(
    (newDate: string) => {
      router.replace(`/dashboard?view=trend&date=${newDate}`, {
        scroll: false,
      });
    },
    [router],
  );

  const handleViewModeChange = useCallback(
    (mode: ViewType) => {
      router.replace(`/dashboard?view=${mode}&date=${date}`, {
        scroll: false,
      });
    },
    [router, date],
  );

  return (
    <div className="space-y-4">
      <DateNavigation
        date={date}
        onDateChange={handleDateChange}
        viewMode="trend"
        onViewModeChange={handleViewModeChange}
        viewModes={["night", "recovery", "trend"]}
      />
      <TrendDetailView
        date={date}
        onDateChange={handleDateChange}
        onViewModeChange={handleViewModeChange}
      />
    </div>
  );
}
