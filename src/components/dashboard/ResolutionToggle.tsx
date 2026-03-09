"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Resolution = "daily" | "weekly" | "monthly";

interface ResolutionToggleProps {
  value: Resolution;
  onChange: (resolution: Resolution) => void;
}

export function ResolutionToggle({ value, onChange }: ResolutionToggleProps) {
  return (
    <Tabs
      value={value}
      onValueChange={(v) => onChange(v as Resolution)}
      data-testid="resolution-toggle"
    >
      <TabsList className="h-8">
        <TabsTrigger value="daily" className="px-3 text-xs">
          Daily
        </TabsTrigger>
        <TabsTrigger value="weekly" className="px-3 text-xs">
          Weekly
        </TabsTrigger>
        <TabsTrigger value="monthly" className="px-3 text-xs">
          Monthly
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
