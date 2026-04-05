"use client";

import { useState, useCallback } from "react";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { DateNavigation } from "@/components/dashboard/DateNavigation";
import { NightDetailView } from "@/components/dashboard/NightDetailView";
import type { ViewType } from "@/lib/dashboard/types";

/**
 * Night Detail View page — dashboard route for viewing a single night's data.
 *
 * Composes DateNavigation at the top with the NightDetailView component.
 * Uses URL search params for date state so pages are deep-linkable.
 *
 * See: wireframes W1 and scenario S1 (Late Meal Disrupts Sleep)
 */
export default function NightViewPage() {
  const router = useRouter();

  // Default to today's date
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));

  const handleDateChange = useCallback((newDate: string) => {
    setDate(newDate);
  }, []);

  const handleViewModeChange = useCallback(
    (mode: ViewType) => {
      if (mode === "recovery") {
        router.push(`/dashboard/recovery?date=${date}`);
      } else if (mode === "trend") {
        router.push(`/dashboard/trend?date=${date}`);
      }
      // "night" is the current view, no navigation needed
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
