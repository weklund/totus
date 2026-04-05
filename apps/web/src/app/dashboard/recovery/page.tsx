"use client";

import { useState, useCallback, useMemo } from "react";
import { format, subDays, parseISO } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import { DateNavigation } from "@/components/dashboard/DateNavigation";
import { RecoveryDetailView } from "@/components/dashboard/RecoveryDetailView";
import type { ViewType } from "@/lib/dashboard/types";

/**
 * Recovery View page — dashboard route for viewing multi-day recovery arcs.
 *
 * Composes DateNavigation at the top with the RecoveryDetailView component.
 * Default range: 5 days ending at the selected date.
 *
 * See: wireframe W2 and scenario S3 (Hard Workout Recovery Arc)
 */
export default function RecoveryViewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read date from URL search params, default to today
  const initialDate =
    searchParams.get("date") ?? format(new Date(), "yyyy-MM-dd");
  const initialEventId = searchParams.get("event_id") ?? undefined;

  const [date, setDate] = useState(initialDate);

  // Recovery view shows a date range. Default to 5 days ending at the selected date.
  const dateRange = useMemo(() => {
    try {
      const endDate = parseISO(date);
      const startDate = subDays(endDate, 4); // 5-day range
      return {
        start: format(startDate, "yyyy-MM-dd"),
        end: format(endDate, "yyyy-MM-dd"),
      };
    } catch {
      return {
        start: date,
        end: date,
      };
    }
  }, [date]);

  const handleDateChange = useCallback((newDate: string) => {
    setDate(newDate);
  }, []);

  const handleViewModeChange = useCallback(
    (mode: ViewType) => {
      if (mode === "night") {
        router.push(`/dashboard/night?date=${date}`);
      } else if (mode === "trend") {
        router.push(`/dashboard/trend?date=${date}`);
      }
      // "recovery" is the current view, no navigation needed
    },
    [router, date],
  );

  return (
    <div className="space-y-4">
      <DateNavigation
        date={date}
        onDateChange={handleDateChange}
        viewMode="recovery"
        onViewModeChange={handleViewModeChange}
        viewModes={["night", "recovery", "trend"]}
      />
      <RecoveryDetailView
        startDate={dateRange.start}
        endDate={dateRange.end}
        eventId={initialEventId}
        onDateChange={handleDateChange}
        onViewModeChange={handleViewModeChange}
      />
    </div>
  );
}
