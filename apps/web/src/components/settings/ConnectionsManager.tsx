"use client";

import { useConnections } from "@/hooks/useConnections";
import { ConnectionCard } from "@/components/dashboard/ConnectionCard";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorCard } from "@/components/dashboard/ErrorCard";

/**
 * ConnectionsManager — settings page section for managing data source connections.
 *
 * Lists the user's connections with connect/disconnect actions.
 * Shows a connect card if no Oura connection exists.
 */
export function ConnectionsManager() {
  const { data, isLoading, error, refetch } = useConnections();

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-[72px] w-full rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorCard
        title="Failed to load connections"
        message={error.message || "Could not load your data sources."}
        onRetry={() => refetch()}
      />
    );
  }

  const connections = data?.data ?? [];
  const ouraConnection = connections.find((c) => c.provider === "oura");

  return (
    <div className="space-y-3" data-testid="connections-manager">
      <ConnectionCard
        connection={ouraConnection}
        onDisconnected={() => refetch()}
      />
    </div>
  );
}
