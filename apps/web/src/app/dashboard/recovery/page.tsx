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

  // Read date and start/end from URL search params (VAL-UIRCV-003)
  const date = searchParams.get("date") ?? format(new Date(), "yyyy-MM-dd");
  const urlStart = searchParams.get("start");
  const urlEnd = searchParams.get("end");
  const eventId = searchParams.get("event_id") ?? undefined;

  // Derive initial recovery range from URL start/end if provided
  const initialRangeDays = useMemo(() => {
    if (urlStart && urlEnd) {
      try {
        const s = parseISO(urlStart);
        const e = parseISO(urlEnd);
        if (s <= e) {
          const diffDays =
            Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
          return Math.max(3, Math.min(14, diffDays));
        }
      } catch {
        // fall through
      }
    }
    return 5;
  }, [urlStart, urlEnd]);

  // Recovery range state (3–14 days, default from URL or 5)
  const [rangeDays, setRangeDays] = useState(initialRangeDays);

  // Recovery view shows a date range ending at the selected date,
  // or uses URL start/end directly if provided.
  const dateRange = useMemo(() => {
    // Prefer explicit start/end from URL params
    if (urlStart && urlEnd) {
      try {
        const s = parseISO(urlStart);
        const e = parseISO(urlEnd);
        if (s <= e) {
          const diffDays =
            Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
          if (diffDays >= 3 && diffDays <= 14) {
            return {
              start: format(s, "yyyy-MM-dd"),
              end: format(e, "yyyy-MM-dd"),
            };
          }
        }
      } catch {
        // fall through
      }
    }
    // Default: compute from date + rangeDays
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
  }, [date, rangeDays, urlStart, urlEnd]);

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
