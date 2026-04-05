"use client";

import { useState } from "react";
import { format, addDays, subDays, parseISO, isToday } from "date-fns";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import type { ViewType } from "@/lib/dashboard/types";

interface DateNavigationProps {
  /** Current selected date (YYYY-MM-DD) */
  date: string;
  /** Callback when date changes */
  onDateChange: (date: string) => void;
  /** Current view mode */
  viewMode: ViewType;
  /** Callback when view mode changes */
  onViewModeChange: (mode: ViewType) => void;
  /** Available view modes to show in toggle */
  viewModes?: ViewType[];
  /** Earliest data date — back arrow disabled before this */
  minDate?: string;
  /** Latest data date — forward arrow disabled after this */
  maxDate?: string;
}

const VIEW_LABELS: Record<string, string> = {
  night: "Night",
  recovery: "Recovery",
  trend: "Trend",
  weekly: "Weekly",
  anomaly: "Anomaly",
};

/**
 * DateNavigation — date picker, forward/back arrows, and view mode toggle.
 *
 * - Date picker opens a calendar on click.
 * - Forward arrow is disabled at today.
 * - Back arrow is disabled at the earliest data date.
 * - View toggle switches between Night / Recovery / Trend while preserving date.
 *
 * See: wireframes W1-W3, W6 in /docs/design/wireframes.md
 */
export function DateNavigation({
  date,
  onDateChange,
  viewMode,
  onViewModeChange,
  viewModes = ["night", "recovery", "trend"],
  minDate,
  maxDate,
}: DateNavigationProps) {
  const [calendarOpen, setCalendarOpen] = useState(false);

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const effectiveMaxDate = maxDate ?? todayStr;

  const isAtEnd = date >= effectiveMaxDate;
  const isAtStart = minDate ? date <= minDate : false;

  function handlePrev() {
    if (isAtStart) return;
    const prev = format(subDays(parseISO(date), 1), "yyyy-MM-dd");
    onDateChange(minDate && prev < minDate ? minDate : prev);
  }

  function handleNext() {
    if (isAtEnd) return;
    const next = format(addDays(parseISO(date), 1), "yyyy-MM-dd");
    onDateChange(next > effectiveMaxDate ? effectiveMaxDate : next);
  }

  function handleCalendarSelect(selected: Date | undefined) {
    if (selected) {
      const formatted = format(selected, "yyyy-MM-dd");
      onDateChange(formatted);
      setCalendarOpen(false);
    }
  }

  let dateLabel: string;
  try {
    const parsed = parseISO(date);
    dateLabel = isToday(parsed) ? "Today" : format(parsed, "EEE, MMM d, yyyy");
  } catch {
    dateLabel = date;
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3"
      data-testid="date-navigation"
    >
      {/* Left: date controls */}
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handlePrev}
          disabled={isAtStart}
          aria-label="Previous day"
          data-testid="date-nav-prev"
        >
          <ChevronLeft className="size-4" />
        </Button>

        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-sm font-medium"
              data-testid="date-nav-picker"
            >
              <CalendarIcon className="size-3.5" />
              {dateLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={safeParseISO(date)}
              onSelect={handleCalendarSelect}
              disabled={[
                ...(minDate ? [{ before: parseISO(minDate) }] : []),
                { after: parseISO(effectiveMaxDate) },
              ]}
              data-testid="date-nav-calendar"
            />
          </PopoverContent>
        </Popover>

        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleNext}
          disabled={isAtEnd}
          aria-label="Next day"
          data-testid="date-nav-next"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {/* Right: view mode toggle */}
      <div
        className="bg-muted inline-flex items-center gap-0.5 rounded-lg p-0.5"
        role="tablist"
        aria-label="View mode"
        data-testid="view-mode-toggle"
      >
        {viewModes.map((mode) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={viewMode === mode}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              viewMode === mode
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onViewModeChange(mode)}
            data-testid={`view-mode-${mode}`}
          >
            {VIEW_LABELS[mode] ?? mode}
          </button>
        ))}
      </div>
    </div>
  );
}

function safeParseISO(s: string): Date | undefined {
  try {
    return parseISO(s);
  } catch {
    return undefined;
  }
}
