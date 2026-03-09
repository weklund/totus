"use client";

import { useState, useMemo, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { format, subDays } from "date-fns";
import { toast } from "sonner";
import { useViewContext } from "@/lib/view-context";
import { useHealthDataTypes } from "@/hooks/useHealthDataTypes";
import { MetricSelector } from "./MetricSelector";
import { DateRangeSelector } from "./DateRangeSelector";
import { ResolutionToggle } from "./ResolutionToggle";
import { ChartGrid } from "./ChartGrid";
import { ActionBar } from "./ActionBar";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

/**
 * Default selected metrics when dashboard first loads.
 */
const DEFAULT_METRICS = [
  "sleep_score",
  "hrv",
  "rhr",
  "steps",
  "readiness_score",
];

type Resolution = "daily" | "weekly" | "monthly";

/**
 * DashboardContent — main client component orchestrating the dashboard.
 *
 * Manages metric selection, date range, and resolution state.
 * Handles OAuth callback query params for toasts.
 */
export function DashboardContent() {
  const { role, permissions } = useViewContext();
  const searchParams = useSearchParams();
  const router = useRouter();

  // ─── Fetch available metric types ──────────────────────────────
  const { data: typesData, isLoading: typesLoading } = useHealthDataTypes();
  const availableMetrics = useMemo(
    () => typesData?.data?.types ?? [],
    [typesData],
  );

  // Compute earliest/latest data dates across all metrics
  const { earliestDate, latestDate } = useMemo(() => {
    if (availableMetrics.length === 0) {
      return { earliestDate: undefined, latestDate: undefined };
    }
    let earliest = "9999-12-31";
    let latest = "0000-01-01";
    for (const m of availableMetrics) {
      if (m.date_range.start < earliest) earliest = m.date_range.start;
      if (m.date_range.end > latest) latest = m.date_range.end;
    }
    return { earliestDate: earliest, latestDate: latest };
  }, [availableMetrics]);

  // ─── State ──────────────────────────────────────────────────────
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({
    start: format(subDays(new Date(), 90), "yyyy-MM-dd"),
    end: format(new Date(), "yyyy-MM-dd"),
  });
  const [resolution, setResolution] = useState<Resolution>("daily");
  const [metricsInitialized, setMetricsInitialized] = useState(false);

  // Initialize selected metrics once types load
  useEffect(() => {
    if (metricsInitialized || availableMetrics.length === 0) return;

    const availableIds = new Set(availableMetrics.map((m) => m.metric_type));

    if (role === "viewer") {
      // Viewer: select all granted metrics
      const grantedMetrics =
        permissions.metrics === "all"
          ? Array.from(availableIds)
          : (permissions.metrics as string[]).filter((m) =>
              availableIds.has(m),
            );
      setSelectedMetrics(grantedMetrics.slice(0, 3));

      // Set date range to grant boundaries
      if (permissions.dataStart && permissions.dataEnd) {
        setDateRange({
          start: permissions.dataStart,
          end: permissions.dataEnd,
        });
      }
    } else {
      // Owner: select defaults that have data
      const defaults = DEFAULT_METRICS.filter((m) => availableIds.has(m));
      setSelectedMetrics(
        defaults.length > 0
          ? defaults.slice(0, 3)
          : Array.from(availableIds).slice(0, 3),
      );
    }

    setMetricsInitialized(true);
  }, [availableMetrics, metricsInitialized, role, permissions]);

  // ─── OAuth callback toasts ──────────────────────────────────────
  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");

    if (connected === "oura") {
      toast.success("Oura Ring connected successfully!");
      // Clean URL
      router.replace("/dashboard", { scroll: false });
    } else if (error) {
      toast.error(decodeURIComponent(error));
      router.replace("/dashboard", { scroll: false });
    }
  }, [searchParams, router]);

  // ─── Empty state: no data at all ───────────────────────────────
  if (!typesLoading && availableMetrics.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <div className="bg-muted flex size-16 items-center justify-center rounded-full">
          <BarChart3 className="text-muted-foreground size-8" />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-semibold">No health data yet</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Connect your Oura Ring to start seeing your health data.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/settings">Connect Oura</Link>
        </Button>
      </div>
    );
  }

  // Viewer constraints
  const isViewer = role === "viewer";
  const minDate =
    isViewer && permissions.dataStart ? permissions.dataStart : undefined;
  const maxDate =
    isViewer && permissions.dataEnd ? permissions.dataEnd : undefined;

  return (
    <div className="space-y-6" data-testid="dashboard-content">
      {/* Toolbar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 space-y-4">
          {/* Metric selector */}
          {typesLoading ? (
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-24 rounded-full" />
              ))}
            </div>
          ) : (
            <MetricSelector
              availableMetrics={availableMetrics}
              selectedMetrics={selectedMetrics}
              onSelectionChange={setSelectedMetrics}
              maxSelection={3}
              readOnly={false}
            />
          )}

          {/* Date range + resolution */}
          <div className="flex flex-wrap items-center gap-4">
            <DateRangeSelector
              value={dateRange}
              onChange={setDateRange}
              minDate={minDate}
              maxDate={maxDate}
              showPresets={!isViewer}
              earliestDataDate={earliestDate}
              latestDataDate={latestDate}
            />
            <ResolutionToggle value={resolution} onChange={setResolution} />
          </div>
        </div>

        {/* Action bar (owner only) */}
        <ActionBar />
      </div>

      {/* Charts */}
      <ChartGrid
        selectedMetrics={selectedMetrics}
        dateRange={dateRange}
        resolution={resolution}
      />
    </div>
  );
}
