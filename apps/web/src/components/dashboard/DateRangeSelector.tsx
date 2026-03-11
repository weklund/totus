"use client";

import { useState } from "react";
import { format, subDays, parseISO } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

const DATE_PRESETS = [
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "5Y", days: 1825 },
  { label: "All", days: null },
] as const;

interface DateRangeSelectorProps {
  /** Current date range */
  value: { start: string; end: string };
  /** Callback when range changes */
  onChange: (range: { start: string; end: string }) => void;
  /** Minimum selectable date (viewer: grant data_start) */
  minDate?: string;
  /** Maximum selectable date (viewer: grant data_end) */
  maxDate?: string;
  /** Whether to show preset buttons */
  showPresets?: boolean;
  /** Earliest data date (for "All" preset) */
  earliestDataDate?: string;
  /** Latest data date (for "All" preset) */
  latestDataDate?: string;
}

export function DateRangeSelector({
  value,
  onChange,
  minDate,
  maxDate,
  showPresets = true,
  earliestDataDate,
  latestDataDate,
}: DateRangeSelectorProps) {
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const today = new Date();
  const todayStr = format(today, "yyyy-MM-dd");

  function handlePreset(preset: (typeof DATE_PRESETS)[number]) {
    let endDate = maxDate || latestDataDate || todayStr;
    let startDate: string;

    if (preset.days === null) {
      // "All" preset: use earliest/latest data dates
      startDate = earliestDataDate || minDate || "2020-01-01";
      endDate = latestDataDate || maxDate || todayStr;
    } else {
      startDate = format(subDays(parseISO(endDate), preset.days), "yyyy-MM-dd");
    }

    // Clamp to min/max if viewer
    if (minDate && startDate < minDate) {
      startDate = minDate;
    }

    setActivePreset(preset.label);
    onChange({ start: startDate, end: endDate });
  }

  function handleCalendarSelect(range: { from?: Date; to?: Date } | undefined) {
    if (range?.from && range?.to) {
      let start = format(range.from, "yyyy-MM-dd");
      let end = format(range.to, "yyyy-MM-dd");

      // Clamp to min/max
      if (minDate && start < minDate) start = minDate;
      if (maxDate && end > maxDate) end = maxDate;

      setActivePreset(null);
      onChange({ start, end });
      setCalendarOpen(false);
    }
  }

  const fromDate = value.start ? parseISO(value.start) : undefined;
  const toDate = value.end ? parseISO(value.end) : undefined;

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="date-range-selector"
    >
      {showPresets &&
        DATE_PRESETS.map((preset) => (
          <Button
            key={preset.label}
            variant={activePreset === preset.label ? "default" : "outline"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => handlePreset(preset)}
            data-testid={`preset-${preset.label}`}
          >
            {preset.label}
          </Button>
        ))}

      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-7 justify-start gap-1.5 px-2.5 text-xs font-normal",
              !activePreset && "border-primary",
            )}
            data-testid="custom-date-picker"
          >
            <CalendarIcon className="size-3.5" />
            {value.start && value.end
              ? `${format(parseISO(value.start), "MMM d, yyyy")} – ${format(parseISO(value.end), "MMM d, yyyy")}`
              : "Custom range"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={
              fromDate && toDate ? { from: fromDate, to: toDate } : undefined
            }
            onSelect={handleCalendarSelect}
            numberOfMonths={2}
            disabled={[
              ...(minDate ? [{ before: parseISO(minDate) }] : []),
              ...(maxDate ? [{ after: parseISO(maxDate) }] : []),
            ]}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
