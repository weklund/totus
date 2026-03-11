"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const STATUS_TABS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "expired", label: "Expired" },
  { value: "revoked", label: "Revoked" },
] as const;

interface ShareFiltersProps {
  status: string;
  onStatusChange: (status: string) => void;
}

export function ShareFilters({ status, onStatusChange }: ShareFiltersProps) {
  return (
    <Tabs
      value={status}
      onValueChange={onStatusChange}
      data-testid="share-filters"
    >
      <TabsList>
        {STATUS_TABS.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
