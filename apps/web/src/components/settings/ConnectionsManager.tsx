"use client";

import { useConnections } from "@/hooks/useConnections";
import { ProviderConnectionCard } from "@/components/dashboard/ProviderConnectionCard";
import { AddProviderDialog } from "@/components/dashboard/AddProviderDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorCard } from "@/components/dashboard/ErrorCard";
import { getAllProviders } from "@/config/providers";

/**
 * ConnectionsManager — settings page section for managing data source connections.
 *
 * Lists all providers: connected ones show status/sync/disconnect actions,
 * and an "Add Data Source" button allows connecting new providers.
 */
export function ConnectionsManager() {
  const { data, isLoading, error, refetch } = useConnections();

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-[72px] w-full rounded-lg" />
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
  const connectedProviderIds = new Set(connections.map((c) => c.provider));
  const allProviders = getAllProviders();

  return (
    <div className="space-y-3" data-testid="connections-manager">
      {/* Show a card for each connected provider */}
      {connections.map((conn) => (
        <ProviderConnectionCard
          key={conn.id}
          providerId={conn.provider}
          connection={conn}
          onDisconnected={() => refetch()}
        />
      ))}

      {/* Show cards for unconnected providers that are available */}
      {allProviders
        .filter((p) => !connectedProviderIds.has(p.id))
        .slice(
          0,
          0,
        ) /* Don't show unconnected cards inline — use dialog instead */
        .map((p) => (
          <ProviderConnectionCard
            key={p.id}
            providerId={p.id}
            onDisconnected={() => refetch()}
          />
        ))}

      {/* Add provider dialog to connect new sources */}
      <AddProviderDialog connections={connections} />
    </div>
  );
}
