"use client";

import { useCallback, useMemo, useState } from "react";
import { format, subDays, parseISO } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import { DateNavigation } from "@/components/dashboard/DateNavigation";
import { RecoveryDetailView } from "@/components/dashboard/RecoveryDetailView";
import type { ViewType } from "@/lib/dashboard/types";

/**
 * Recovery View page — dashboard route for viewing multi-day recovery arcs.
 *
 * Reads date from URL search params for deep-linkable state.
 * View switching navigates to the main dashboard route with URL params.
 *
 * See: wireframe W2 and scenario S3 (Hard Workout Recovery Arc)
 */
export default function RecoveryViewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read date from URL search params, default to today
  const date = searchParams.get("date") ?? format(new Date(), "yyyy-MM-dd");
  const eventId = searchParams.get("event_id") ?? undefined;

  // Recovery range state (3–7 days, default 5)
  const [rangeDays, setRangeDays] = useState(5);

  // Recovery view shows a date range ending at the selected date.
  const dateRange = useMemo(() => {
    try {
      const endDate = parseISO(date);
      const startDate = subDays(endDate, rangeDays - 1);
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
  }, [date, rangeDays]);

  const handleDateChange = useCallback(
    (newDate: string) => {
      router.push(`/dashboard?view=recovery&date=${newDate}`, {
        scroll: false,
      });
    },
    [router],
  );

  const handleViewModeChange = useCallback(
    (mode: ViewType) => {
      router.push(`/dashboard?view=${mode}&date=${date}`, {
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
        viewMode="recovery"
        onViewModeChange={handleViewModeChange}
        viewModes={["night", "recovery", "trend"]}
      />
      <RecoveryDetailView
        startDate={dateRange.start}
        endDate={dateRange.end}
        eventId={eventId}
        rangeDays={rangeDays}
        onRangeDaysChange={setRangeDays}
        onDateChange={handleDateChange}
        onViewModeChange={handleViewModeChange}
      />
    </div>
  );
}
