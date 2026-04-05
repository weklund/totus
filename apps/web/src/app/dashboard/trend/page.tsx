"use client";

import { useState, useCallback } from "react";
import { format } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import { DateNavigation } from "@/components/dashboard/DateNavigation";
import { TrendDetailView } from "@/components/dashboard/TrendDetailView";
import type { ViewType } from "@/lib/dashboard/types";

/**
 * Trend View page — dashboard route for viewing 30-day (or other range) trend data.
 *
 * Composes DateNavigation at the top with the TrendDetailView component.
 * Default: 30-day range ending at the selected date.
 *
 * See: wireframe W3 and scenario S4 (Doctor Visit Preparation)
 */
export default function TrendViewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read date from URL search params, default to today
  const initialDate =
    searchParams.get("date") ?? format(new Date(), "yyyy-MM-dd");

  const [date, setDate] = useState(initialDate);

  const handleDateChange = useCallback((newDate: string) => {
    setDate(newDate);
  }, []);

  const handleViewModeChange = useCallback(
    (mode: ViewType) => {
      if (mode === "night") {
        router.push(`/dashboard/night?date=${date}`);
      } else if (mode === "recovery") {
        router.push(`/dashboard/recovery?date=${date}`);
      }
      // "trend" is the current view, no navigation needed
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
