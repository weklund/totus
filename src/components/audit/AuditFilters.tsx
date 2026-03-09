"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarIcon, X } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/cn";
import type { AuditFilters as AuditFiltersType } from "@/hooks/useAuditLog";

const EVENT_TYPES = [
  { value: "all", label: "All Events" },
  { value: "data.viewed", label: "Data Viewed" },
  { value: "data.exported", label: "Data Exported" },
  { value: "data.synced", label: "Data Synced" },
  { value: "data.imported", label: "Data Imported" },
  { value: "share.created", label: "Share Created" },
  { value: "share.revoked", label: "Share Revoked" },
  { value: "share.viewed", label: "Share Viewed" },
  { value: "share.deleted", label: "Share Deleted" },
  { value: "account.connected", label: "Account Connected" },
  { value: "account.disconnected", label: "Account Disconnected" },
  { value: "account.settings", label: "Settings Changed" },
];

const ACTOR_TYPES = [
  { value: "all", label: "All Actors" },
  { value: "owner", label: "You" },
  { value: "viewer", label: "Viewers" },
  { value: "system", label: "System" },
];

interface AuditFiltersProps {
  filters: AuditFiltersType;
  onFiltersChange: (filters: AuditFiltersType) => void;
}

export function AuditFilters({ filters, onFiltersChange }: AuditFiltersProps) {
  const handleEventTypeChange = (value: string) => {
    onFiltersChange({
      ...filters,
      eventType: value === "all" ? undefined : value,
    });
  };

  const handleActorTypeChange = (value: string) => {
    onFiltersChange({
      ...filters,
      actorType: value === "all" ? undefined : value,
    });
  };

  const handleStartDateChange = (date: Date | undefined) => {
    onFiltersChange({
      ...filters,
      start: date ? format(date, "yyyy-MM-dd") : undefined,
    });
  };

  const handleEndDateChange = (date: Date | undefined) => {
    onFiltersChange({
      ...filters,
      end: date ? format(date, "yyyy-MM-dd") : undefined,
    });
  };

  const handleClearDates = () => {
    onFiltersChange({
      ...filters,
      start: undefined,
      end: undefined,
    });
  };

  const hasDateFilters = filters.start || filters.end;

  return (
    <div
      className="flex flex-wrap items-center gap-3"
      data-testid="audit-filters"
    >
      <Select
        value={filters.eventType ?? "all"}
        onValueChange={handleEventTypeChange}
      >
        <SelectTrigger className="w-[180px]" data-testid="event-type-filter">
          <SelectValue placeholder="Event type" />
        </SelectTrigger>
        <SelectContent>
          {EVENT_TYPES.map((type) => (
            <SelectItem key={type.value} value={type.value}>
              {type.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.actorType ?? "all"}
        onValueChange={handleActorTypeChange}
      >
        <SelectTrigger className="w-[140px]" data-testid="actor-type-filter">
          <SelectValue placeholder="Actor" />
        </SelectTrigger>
        <SelectContent>
          {ACTOR_TYPES.map((type) => (
            <SelectItem key={type.value} value={type.value}>
              {type.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-[140px] justify-start text-left font-normal",
              !filters.start && "text-muted-foreground",
            )}
            data-testid="start-date-filter"
          >
            <CalendarIcon className="mr-2 size-4" />
            {filters.start
              ? format(new Date(filters.start), "MMM d, yyyy")
              : "Start date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={filters.start ? new Date(filters.start) : undefined}
            onSelect={handleStartDateChange}
            initialFocus
          />
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-[140px] justify-start text-left font-normal",
              !filters.end && "text-muted-foreground",
            )}
            data-testid="end-date-filter"
          >
            <CalendarIcon className="mr-2 size-4" />
            {filters.end
              ? format(new Date(filters.end), "MMM d, yyyy")
              : "End date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={filters.end ? new Date(filters.end) : undefined}
            onSelect={handleEndDateChange}
            initialFocus
          />
        </PopoverContent>
      </Popover>

      {hasDateFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClearDates}
          className="h-8 gap-1 px-2"
          data-testid="clear-dates-button"
        >
          <X className="size-3.5" />
          Clear dates
        </Button>
      )}
    </div>
  );
}
