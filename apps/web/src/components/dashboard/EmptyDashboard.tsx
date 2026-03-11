"use client";

import { useState } from "react";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddProviderDialog } from "./AddProviderDialog";

/**
 * EmptyDashboard — full-page empty state when no connections exist.
 *
 * Displays an illustration, a heading asking the user to connect a data source,
 * and a CTA that opens the AddProviderDialog to choose from all providers.
 */
export function EmptyDashboard() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div
      className="flex flex-col items-center justify-center gap-6 py-24"
      data-testid="empty-dashboard"
    >
      <div className="bg-primary/10 flex size-20 items-center justify-center rounded-full">
        <Activity className="text-primary size-10" />
      </div>
      <div className="max-w-sm text-center">
        <h2 className="text-xl font-semibold">
          Connect a data source to get started
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Link your health devices to visualize your sleep, activity, and
          recovery data all in one place.
        </p>
      </div>
      <AddProviderDialog
        connections={[]}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        trigger={
          <Button size="lg" data-testid="empty-connect-button">
            <Activity className="size-4" />
            Connect a Data Source
          </Button>
        }
      />
    </div>
  );
}
