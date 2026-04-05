"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { format, parseISO, isValid } from "date-fns";
import { DateNavigation } from "./DateNavigation";
import { NightDetailView } from "./NightDetailView";
import { RecoveryDetailView } from "./RecoveryDetailView";
import { TrendDetailView } from "./TrendDetailView";
import type { ViewType } from "@/lib/dashboard/types";

/**
 * Valid dashboard view types for the router.
 * P0 MVP supports night, recovery, and trend.
 */
const VALID_VIEWS = new Set<ViewType>(["night", "recovery", "trend"]);
const DEFAULT_VIEW: ViewType = "night";

/**
 * Parse and validate a ViewType from a string.
 * Falls back to "night" for invalid values.
 */
function parseViewParam(value: string | null): ViewType {
  if (value && VALID_VIEWS.has(value as ViewType)) {
    return value as ViewType;
  }
  return DEFAULT_VIEW;
}

/**
 * Parse and validate a date string from URL params.
 * Returns today's date for invalid or missing values.
 */
function parseDateParam(value: string | null): string {
  if (value) {
    try {
      const parsed = parseISO(value);
      if (isValid(parsed)) {
        return format(parsed, "yyyy-MM-dd");
      }
    } catch {
      // fall through to default
    }
  }
  return format(new Date(), "yyyy-MM-dd");
}

/**
 * Build the URL search string for the given view and date.
 */
function buildSearchString(view: ViewType, date: string): string {
  const params = new URLSearchParams();
  params.set("view", view);
  params.set("date", date);
  return `/dashboard?${params.toString()}`;
}

/**
 * DashboardViewRouter — client-side router for switching between Night, Recovery,
 * and Trend views using URL search params.
 *
 * URL format: /dashboard?view=night&date=2026-03-28
 *
 * Features:
 * - Deep linking: URL params control which view and date are displayed
 * - View switching: clicking Night/Recovery/Trend updates URL without page reload
 * - Date navigation: arrows and calendar update URL date param
 * - Browser history: uses router.replace for seamless back/forward
 * - Defaults: night view + today's date when no params provided
 */
export function DashboardViewRouter() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Read state from URL params
  const view = parseViewParam(searchParams.get("view"));
  const date = parseDateParam(searchParams.get("date"));

  // Handle view mode changes — update URL
  const handleViewModeChange = useCallback(
    (newView: ViewType) => {
      router.replace(buildSearchString(newView, date), { scroll: false });
    },
    [router, date],
  );

  // Handle date changes — update URL
  const handleDateChange = useCallback(
    (newDate: string) => {
      router.replace(buildSearchString(view, newDate), { scroll: false });
    },
    [router, view],
  );

  // Compute recovery date range (5 days ending at selected date)
  const recoveryRange = useMemo(() => {
    try {
      const endDate = parseISO(date);
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 4);
      return {
        start: format(startDate, "yyyy-MM-dd"),
        end: format(endDate, "yyyy-MM-dd"),
      };
    } catch {
      return { start: date, end: date };
    }
  }, [date]);

  return (
    <div className="space-y-4" data-testid="dashboard-view-router">
      <DateNavigation
        date={date}
        onDateChange={handleDateChange}
        viewMode={view}
        onViewModeChange={handleViewModeChange}
        viewModes={["night", "recovery", "trend"]}
      />

      {view === "night" && (
        <NightDetailView
          date={date}
          onDateChange={handleDateChange}
          onViewModeChange={handleViewModeChange}
        />
      )}

      {view === "recovery" && (
        <RecoveryDetailView
          startDate={recoveryRange.start}
          endDate={recoveryRange.end}
          onDateChange={handleDateChange}
          onViewModeChange={handleViewModeChange}
        />
      )}

      {view === "trend" && (
        <TrendDetailView
          date={date}
          onDateChange={handleDateChange}
          onViewModeChange={handleViewModeChange}
        />
      )}
    </div>
  );
}
