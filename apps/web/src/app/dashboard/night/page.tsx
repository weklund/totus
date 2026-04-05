"use client";

import { useCallback } from "react";
import { format } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import { DateNavigation } from "@/components/dashboard/DateNavigation";
import { NightDetailView } from "@/components/dashboard/NightDetailView";
import type { ViewType } from "@/lib/dashboard/types";

/**
 * Night Detail View page — dashboard route for viewing a single night's data.
 *
 * Reads date from URL search params for deep-linkable state.
 * View switching navigates to the main dashboard route with URL params.
 *
 * See: wireframes W1 and scenario S1 (Late Meal Disrupts Sleep)
 */
export default function NightViewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read date from URL search params, default to today
  const date = searchParams.get("date") ?? format(new Date(), "yyyy-MM-dd");

  const handleDateChange = useCallback(
    (newDate: string) => {
      router.replace(`/dashboard?view=night&date=${newDate}`, {
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
        viewMode="night"
        onViewModeChange={handleViewModeChange}
        viewModes={["night", "recovery", "trend"]}
      />
      <NightDetailView
        date={date}
        onDateChange={handleDateChange}
        onViewModeChange={handleViewModeChange}
      />
    </div>
  );
}
