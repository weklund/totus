"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { format, parseISO, isValid, subYears } from "date-fns";
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

/** Valid trend range presets (in days). */
const VALID_RANGE_DAYS = new Set([7, 30, 90, 365]);

/** Valid trend smoothing values. */
const VALID_SMOOTHING = new Set(["daily", "weekly", "monthly"]);

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
 * Parse and validate a trend range preset from URL params.
 * Falls back to 30 (30D default) for invalid values.
 */
function parseRangeParam(value: string | null): number {
  if (value) {
    const n = Number(value);
    if (VALID_RANGE_DAYS.has(n)) return n;
  }
  return 30;
}

/**
 * Parse and validate a trend smoothing value from URL params.
 * Falls back to "weekly" (7-day avg) for invalid values.
 */
function parseSmoothingParam(
  value: string | null,
): "daily" | "weekly" | "monthly" {
  if (value && VALID_SMOOTHING.has(value)) {
    return value as "daily" | "weekly" | "monthly";
  }
  return "weekly";
}

/**
 * Build the URL search string for the given view, date, and optional
 * trend sub-state (range, smoothing). Trend sub-state is only included
 * when view === "trend" so the URL stays clean for other views.
 */
function buildSearchString(
  view: ViewType,
  date: string,
  trendState?: { range?: number; smoothing?: string },
): string {
  const params = new URLSearchParams();
  params.set("view", view);
  params.set("date", date);
  if (view === "trend" && trendState) {
    if (trendState.range != null) params.set("range", String(trendState.range));
    if (trendState.smoothing) params.set("smoothing", trendState.smoothing);
  }
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
 * - Browser history: uses router.push for view/date transitions to preserve history
 * - Defaults: night view + today's date when no params provided
 */
export function DashboardViewRouter() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Read state from URL params
  const view = parseViewParam(searchParams.get("view"));
  const date = parseDateParam(searchParams.get("date"));

  // Trend sub-state from URL params (range preset + smoothing resolution)
  const trendRange = parseRangeParam(searchParams.get("range"));
  const trendSmoothing = parseSmoothingParam(searchParams.get("smoothing"));

  // Recovery range state (3–7 days, default 5)
  const [recoveryRangeDays, setRecoveryRangeDays] = useState(5);

  // Handle view mode changes — update URL.
  // Use router.push (not replace) so the browser back button works after
  // user-initiated view transitions.
  const handleViewModeChange = useCallback(
    (newView: ViewType) => {
      // Preserve trend state when switching back to trend view
      const ts =
        newView === "trend"
          ? { range: trendRange, smoothing: trendSmoothing }
          : undefined;
      router.push(buildSearchString(newView, date, ts), { scroll: false });
    },
    [router, date, trendRange, trendSmoothing],
  );

  // Handle date changes — update URL.
  // Use router.push (not replace) so the browser back button works after
  // user-initiated date changes.
  const handleDateChange = useCallback(
    (newDate: string) => {
      const ts =
        view === "trend"
          ? { range: trendRange, smoothing: trendSmoothing }
          : undefined;
      router.push(buildSearchString(view, newDate, ts), { scroll: false });
    },
    [router, view, trendRange, trendSmoothing],
  );

  // Handle trend range preset changes — update URL.
  const handleTrendRangeChange = useCallback(
    (days: number) => {
      router.push(
        buildSearchString("trend", date, {
          range: days,
          smoothing: trendSmoothing,
        }),
        { scroll: false },
      );
    },
    [router, date, trendSmoothing],
  );

  // Handle trend smoothing/resolution changes — update URL.
  const handleTrendSmoothingChange = useCallback(
    (smoothing: "daily" | "weekly" | "monthly") => {
      router.push(
        buildSearchString("trend", date, { range: trendRange, smoothing }),
        { scroll: false },
      );
    },
    [router, date, trendRange],
  );

  // Default earliest date — 1 year ago (reasonable default when actual earliest
  // data date is not yet known). This prevents navigating into empty data territory.
  const defaultMinDate = useMemo(
    () => format(subYears(new Date(), 1), "yyyy-MM-dd"),
    [],
  );

  // Compute recovery date range (recoveryRangeDays ending at selected date)
  const recoveryRange = useMemo(() => {
    try {
      const endDate = parseISO(date);
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - (recoveryRangeDays - 1));
      return {
        start: format(startDate, "yyyy-MM-dd"),
        end: format(endDate, "yyyy-MM-dd"),
      };
    } catch {
      return { start: date, end: date };
    }
  }, [date, recoveryRangeDays]);

  return (
    <div
      className="max-w-full space-y-4 overflow-x-hidden"
      data-testid="dashboard-view-router"
    >
      <DateNavigation
        date={date}
        onDateChange={handleDateChange}
        viewMode={view}
        onViewModeChange={handleViewModeChange}
        viewModes={["night", "recovery", "trend"]}
        minDate={defaultMinDate}
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
          rangeDays={recoveryRangeDays}
          onRangeDaysChange={setRecoveryRangeDays}
          onDateChange={handleDateChange}
          onViewModeChange={handleViewModeChange}
        />
      )}

      {view === "trend" && (
        <TrendDetailView
          date={date}
          activePreset={trendRange}
          onPresetChange={handleTrendRangeChange}
          resolution={trendSmoothing}
          onResolutionChange={handleTrendSmoothingChange}
          onDateChange={handleDateChange}
          onViewModeChange={handleViewModeChange}
        />
      )}
    </div>
  );
}
