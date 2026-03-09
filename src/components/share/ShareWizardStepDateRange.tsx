"use client";

import { format, subDays, subMonths, subYears } from "date-fns";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";

interface DatePreset {
  label: string;
  getValue: () => { start: string; end: string };
}

const DATE_PRESETS: DatePreset[] = [
  {
    label: "Last 30 days",
    getValue: () => ({
      start: format(subDays(new Date(), 30), "yyyy-MM-dd"),
      end: format(new Date(), "yyyy-MM-dd"),
    }),
  },
  {
    label: "Last 90 days",
    getValue: () => ({
      start: format(subDays(new Date(), 90), "yyyy-MM-dd"),
      end: format(new Date(), "yyyy-MM-dd"),
    }),
  },
  {
    label: "Last 180 days",
    getValue: () => ({
      start: format(subMonths(new Date(), 6), "yyyy-MM-dd"),
      end: format(new Date(), "yyyy-MM-dd"),
    }),
  },
  {
    label: "Last year",
    getValue: () => ({
      start: format(subYears(new Date(), 1), "yyyy-MM-dd"),
      end: format(new Date(), "yyyy-MM-dd"),
    }),
  },
];

interface ShareWizardStepDateRangeProps {
  dateRange: { start: string; end: string };
  onDateRangeChange: (range: { start: string; end: string }) => void;
  error?: string;
}

export function ShareWizardStepDateRange({
  dateRange,
  onDateRangeChange,
  error,
}: ShareWizardStepDateRangeProps) {
  const selected: DateRange = {
    from: dateRange.start ? new Date(dateRange.start + "T00:00:00") : undefined,
    to: dateRange.end ? new Date(dateRange.end + "T00:00:00") : undefined,
  };

  function handleSelect(range: DateRange | undefined) {
    if (range?.from && range?.to) {
      onDateRangeChange({
        start: format(range.from, "yyyy-MM-dd"),
        end: format(range.to, "yyyy-MM-dd"),
      });
    } else if (range?.from) {
      onDateRangeChange({
        start: format(range.from, "yyyy-MM-dd"),
        end: dateRange.end,
      });
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">Date Range</h3>
        <p className="text-muted-foreground text-sm">
          Select the date range for the data you want to share.
        </p>
      </div>

      {/* Presets */}
      <div className="flex flex-wrap gap-2">
        {DATE_PRESETS.map((preset) => {
          const presetValue = preset.getValue();
          const isActive =
            presetValue.start === dateRange.start &&
            presetValue.end === dateRange.end;
          return (
            <Button
              key={preset.label}
              variant={isActive ? "default" : "outline"}
              size="sm"
              onClick={() => onDateRangeChange(presetValue)}
            >
              {preset.label}
            </Button>
          );
        })}
      </div>

      {/* Custom date picker */}
      <div className="flex items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-[280px] justify-start text-left font-normal",
                !dateRange.start && "text-muted-foreground",
              )}
            >
              <CalendarIcon className="mr-2 size-4" />
              {dateRange.start && dateRange.end
                ? `${format(new Date(dateRange.start + "T00:00:00"), "MMM d, yyyy")} – ${format(new Date(dateRange.end + "T00:00:00"), "MMM d, yyyy")}`
                : "Pick a date range"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              selected={selected}
              onSelect={handleSelect}
              numberOfMonths={2}
              disabled={{ after: new Date() }}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Data availability preview */}
      {dateRange.start && dateRange.end && (
        <p className="text-muted-foreground text-sm">
          Sharing data from{" "}
          <span className="text-foreground font-medium">
            {format(new Date(dateRange.start + "T00:00:00"), "MMM d, yyyy")}
          </span>{" "}
          to{" "}
          <span className="text-foreground font-medium">
            {format(new Date(dateRange.end + "T00:00:00"), "MMM d, yyyy")}
          </span>
        </p>
      )}

      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
