"use client";

import { Wifi } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getProvider } from "@/config/providers";
import { AddProviderDialog } from "./AddProviderDialog";
import type { Connection } from "@/hooks/useConnections";

interface ProviderConnectionBarProps {
  /** The user's current connections */
  connections: Connection[];
}

/**
 * ProviderConnectionBar — horizontal bar at the top of the dashboard
 * showing connected providers as compact pills + an "Add" button.
 *
 * Each pill shows provider name and a green dot for active status,
 * or a warning indicator for expired/error states.
 */
export function ProviderConnectionBar({
  connections,
}: ProviderConnectionBarProps) {
  if (connections.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="provider-connection-bar"
    >
      {connections.map((conn) => {
        const config = getProvider(conn.provider);
        const displayName = config?.displayName ?? conn.provider;

        return (
          <Badge
            key={conn.id}
            variant={conn.status === "active" ? "secondary" : "outline"}
            className="gap-1.5 py-1"
            data-testid={`connection-pill-${conn.provider}`}
          >
            <Wifi className="size-3" />
            <span>{displayName}</span>
            {conn.status === "active" && (
              <span className="size-1.5 rounded-full bg-green-500" />
            )}
            {conn.status === "expired" && (
              <span
                className="size-1.5 rounded-full bg-yellow-500"
                title="Token expired"
              />
            )}
            {conn.status === "error" && (
              <span
                className="size-1.5 rounded-full bg-red-500"
                title="Connection error"
              />
            )}
          </Badge>
        );
      })}
      <AddProviderDialog connections={connections} />
    </div>
  );
}
